/**
 * Voice Processing Tool Plugin
 *
 * UNIQUE FEATURE: Voice note processing for WhatsApp/Telegram.
 * No other claw variant handles voice messages natively.
 *
 * - Transcribe voice notes to text (via Whisper API, whisper CLI, or Windows Speech Recognition)
 * - Generate voice responses (text-to-speech)
 * - Live voice conversation (bidirectional audio chat)
 * - Voice memo summarization
 * - Language detection from audio
 *
 * Works with:
 * - OpenAI Whisper API (cloud)
 * - Local Whisper via whisper.cpp (offline)
 * - Windows Speech Recognition (offline, Windows-only)
 * - ElevenLabs / OpenAI TTS for speech synthesis
 * - Local TTS (espeak, say, PowerShell) as fallback
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, platform } from "node:os";

import type {
  ToolPlugin,
  ToolDefinition,
  ToolResult,
  PluginContext,
} from "../../core/types.js";

const execFileAsync = promisify(execFile);

export class VoiceToolPlugin implements ToolPlugin {
  name = "voice";
  version = "1.0.0";
  type = "tool" as const;
  description = "Voice transcription, synthesis, conversation, and processing";

  private openaiKey = "";
  private log!: PluginContext["log"];
  private processMessage?: PluginContext["processMessage"];
  private voiceChatActive = false;

  tools: ToolDefinition[] = [
    {
      name: "transcribe_audio",
      description: "Transcribe audio/voice note to text using Whisper",
      parameters: {
        url: { type: "string", description: "URL or file path of the audio", required: true },
        language: { type: "string", description: "Language hint (e.g., 'en', 'es')", required: false },
      },
    },
    {
      name: "text_to_speech",
      description: "Convert text to spoken audio",
      parameters: {
        text: { type: "string", description: "Text to speak", required: true },
        voice: { type: "string", description: "Voice: alloy, echo, fable, onyx, nova, shimmer", required: false },
        speed: { type: "number", description: "Speed 0.25 to 4.0 (default: 1.0)", required: false },
      },
    },
    {
      name: "record_audio",
      description: "Record audio from the microphone with automatic silence detection",
      parameters: {
        duration: { type: "number", description: "Max recording duration in seconds (default: 10)", required: false },
        silence_threshold: { type: "number", description: "Silence duration in seconds to auto-stop (default: 2)", required: false },
      },
    },
    {
      name: "voice_chat",
      description: "Start a live voice conversation. Listens on mic, transcribes speech, sends to the agent, and speaks the response. Say 'stop', 'exit', or 'goodbye' to end.",
      parameters: {
        voice: { type: "string", description: "TTS voice: alloy, echo, fable, onyx, nova, shimmer", required: false },
        language: { type: "string", description: "Language hint for transcription (e.g., 'en', 'es')", required: false },
      },
    },
    {
      name: "detect_language",
      description: "Detect the language spoken in an audio file",
      parameters: {
        url: { type: "string", description: "URL or file path of the audio", required: true },
      },
    },
  ];

  async init(ctx: PluginContext): Promise<void> {
    this.openaiKey = process.env["OPENAI_API_KEY"] || "";
    this.log = ctx.log;
    this.processMessage = ctx.processMessage;
  }

  async execute(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    switch (toolName) {
      case "transcribe_audio":
        return this.transcribe(args);
      case "text_to_speech":
        return this.synthesize(args);
      case "record_audio":
        return this.recordAudio(args);
      case "voice_chat":
        return this.voiceChat(args);
      case "detect_language":
        return this.detectLanguage(args);
      default:
        return { success: false, output: "", error: `Unknown tool: ${toolName}` };
    }
  }

  // ─── Cross-platform command detection ────────────────────────────────────

  private async commandExists(cmd: string): Promise<boolean> {
    const os = platform();
    try {
      if (os === "win32") {
        await execFileAsync("cmd", ["/c", "where", cmd]);
      } else {
        await execFileAsync("which", [cmd]);
      }
      return true;
    } catch {
      return false;
    }
  }

  // ─── Transcription (STT) ────────────────────────────────────────────────

  private async transcribe(args: Record<string, unknown>): Promise<ToolResult> {
    const url = args["url"] as string;
    const language = args["language"] as string | undefined;

    // Try OpenAI Whisper API first
    if (this.openaiKey) {
      return this.transcribeWhisperAPI(url, language);
    }

    // Try local whisper CLI (whisper.cpp / openai-whisper)
    const whisperCmd = await this.findLocalWhisper();
    if (whisperCmd) {
      return this.transcribeLocalWhisper(whisperCmd, url, language);
    }

    // Windows fallback: built-in Speech Recognition
    if (platform() === "win32") {
      return this.transcribeWindowsSpeech(url);
    }

    return {
      success: false,
      output: "",
      error: "No speech-to-text engine available. Options:\n" +
        "  1. Set OPENAI_API_KEY for cloud Whisper\n" +
        "  2. Install whisper.cpp: https://github.com/ggerganov/whisper.cpp\n" +
        (platform() === "win32" ? "  3. Windows Speech Recognition should work but failed to initialize\n" : "") +
        "  3. Install openai-whisper: pip install openai-whisper",
    };
  }

  private async transcribeWhisperAPI(url: string, language?: string): Promise<ToolResult> {
    try {
      const audioData = await this.fetchAudio(url);

      const formData = new FormData();
      formData.append("file", new Blob([audioData]), "audio.ogg");
      formData.append("model", "whisper-1");
      if (language) formData.append("language", language);
      formData.append("response_format", "json");

      const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${this.openaiKey}` },
        body: formData,
      });

      if (!res.ok) {
        const err = await res.text();
        return { success: false, output: "", error: `Whisper API error: ${err}` };
      }

      const data = (await res.json()) as { text: string };
      return { success: true, output: data.text, data: { text: data.text, engine: "whisper-api" } };
    } catch (err) {
      return { success: false, output: "", error: `Transcription failed: ${err}` };
    }
  }

  private async findLocalWhisper(): Promise<string | null> {
    // whisper.cpp binary or python openai-whisper
    for (const cmd of ["whisper", "whisper-cpp", "main"]) {
      if (await this.commandExists(cmd)) {
        return cmd;
      }
    }
    return null;
  }

  private async transcribeLocalWhisper(cmd: string, audioPath: string, language?: string): Promise<ToolResult> {
    try {
      // Ensure we have a local file path
      let localPath = audioPath;
      if (audioPath.startsWith("http://") || audioPath.startsWith("https://")) {
        const audioData = await this.fetchAudio(audioPath);
        localPath = join(tmpdir(), `myclaw-whisper-input-${Date.now()}.wav`);
        writeFileSync(localPath, audioData);
      }

      const args = [localPath, "--output-format", "txt"];
      if (language) args.push("--language", language);

      // whisper.cpp uses different flags
      if (cmd === "main" || cmd === "whisper-cpp") {
        const modelPath = process.env["WHISPER_MODEL_PATH"] || "";
        const cppArgs = ["-f", localPath, "--no-timestamps"];
        if (modelPath) cppArgs.push("-m", modelPath);
        if (language) cppArgs.push("-l", language);

        const result = await execFileAsync(cmd, cppArgs, { timeout: 60000 });
        const text = result.stdout.trim();
        return { success: true, output: text, data: { text, engine: "whisper-cpp" } };
      }

      // Python openai-whisper
      const result = await execFileAsync(cmd, args, { timeout: 60000 });
      const text = result.stdout.trim();
      return { success: true, output: text, data: { text, engine: "whisper-local" } };
    } catch (err) {
      return { success: false, output: "", error: `Local whisper failed: ${err}` };
    }
  }

  private async transcribeWindowsSpeech(audioPath: string): Promise<ToolResult> {
    try {
      // Ensure local file
      let localPath = audioPath;
      if (audioPath.startsWith("http://") || audioPath.startsWith("https://")) {
        const audioData = await this.fetchAudio(audioPath);
        localPath = join(tmpdir(), `myclaw-stt-input-${Date.now()}.wav`);
        writeFileSync(localPath, audioData);
      }

      const psScript = `
Add-Type -AssemblyName System.Speech
$recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine
$recognizer.SetInputToWaveFile('${localPath.replace(/'/g, "''")}')
$recognizer.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
try {
  $result = $recognizer.Recognize()
  if ($result) { Write-Output $result.Text }
  else { Write-Error 'No speech recognized' }
} finally {
  $recognizer.Dispose()
}`;

      const result = await execFileAsync("powershell", ["-NoProfile", "-Command", psScript], { timeout: 30000 });
      const text = result.stdout.trim();
      if (!text) {
        return { success: false, output: "", error: "Windows Speech Recognition returned empty result" };
      }
      return { success: true, output: text, data: { text, engine: "windows-speech" } };
    } catch (err) {
      return { success: false, output: "", error: `Windows Speech Recognition failed: ${err}` };
    }
  }

  // ─── Text-to-Speech (TTS) ──────────────────────────────────────────────

  private async synthesize(args: Record<string, unknown>): Promise<ToolResult> {
    const text = args["text"] as string;
    const voice = (args["voice"] as string) || "alloy";
    const speed = (args["speed"] as number) || 1.0;

    // Use OpenAI TTS if API key is available
    if (this.openaiKey) {
      return this.synthesizeOpenAI(text, voice, speed);
    }

    // Fall back to local system TTS (free, no API key needed)
    this.log.info("No OPENAI_API_KEY set — using local TTS fallback");
    return this.synthesizeLocal(text, speed);
  }

  private async synthesizeOpenAI(text: string, voice: string, speed: number): Promise<ToolResult> {
    try {
      const res = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.openaiKey}`,
        },
        body: JSON.stringify({
          model: "tts-1",
          input: text,
          voice,
          speed,
          response_format: "mp3",
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        return { success: false, output: "", error: `TTS API error: ${err}` };
      }

      const audioBuffer = Buffer.from(await res.arrayBuffer());
      const outputPath = join(tmpdir(), `myclaw-tts-${Date.now()}.mp3`);
      writeFileSync(outputPath, audioBuffer);

      await this.playAudio(outputPath);

      return {
        success: true,
        output: `Audio generated and played (OpenAI TTS): ${outputPath}`,
        data: { path: outputPath, sizeBytes: audioBuffer.length, engine: "openai" },
      };
    } catch (err) {
      return { success: false, output: "", error: `TTS failed: ${err}` };
    }
  }

  private async synthesizeLocal(text: string, speed: number): Promise<ToolResult> {
    const outputPath = join(tmpdir(), `myclaw-tts-${Date.now()}.wav`);
    const os = platform();

    try {
      if (os === "darwin") {
        // macOS: built-in 'say' command
        const rate = Math.round(175 * speed); // 175 WPM is default
        await execFileAsync("say", ["-o", outputPath, "--data-format=LEI16@22050", "-r", String(rate), text]);
      } else if (os === "win32") {
        // Windows: PowerShell speech synthesis
        const psScript = `
Add-Type -AssemblyName System.Speech;
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer;
$synth.Rate = [int](${Math.round((speed - 1) * 5)});
$synth.SetOutputToWaveFile('${outputPath.replace(/'/g, "''")}');
$synth.Speak('${text.replace(/'/g, "''")}');
$synth.Dispose();`;
        await execFileAsync("powershell", ["-NoProfile", "-Command", psScript]);
      } else {
        // Linux: try espeak-ng, then espeak
        const ttsCmd = await this.findLocalTTS();
        if (!ttsCmd) {
          return {
            success: false,
            output: "",
            error: "No TTS engine available. Install espeak-ng (`apt install espeak-ng`) or set OPENAI_API_KEY for cloud TTS.",
          };
        }
        const wpm = Math.round(175 * speed);
        await execFileAsync(ttsCmd, ["-w", outputPath, "-s", String(wpm), text]);
      }

      const { statSync } = await import("node:fs");
      const sizeBytes = statSync(outputPath).size;

      await this.playAudio(outputPath);

      return {
        success: true,
        output: `Audio generated and played (local TTS): ${outputPath}`,
        data: { path: outputPath, sizeBytes, engine: "local" },
      };
    } catch (err) {
      return { success: false, output: "", error: `Local TTS failed: ${err}` };
    }
  }

  // ─── Audio Playback ─────────────────────────────────────────────────────

  private async playAudio(filePath: string): Promise<void> {
    const os = platform();
    try {
      if (os === "darwin") {
        await execFileAsync("afplay", [filePath]);
      } else if (os === "win32") {
        // PowerShell can play audio via .NET
        await execFileAsync("powershell", [
          "-NoProfile", "-Command",
          `(New-Object Media.SoundPlayer '${filePath.replace(/'/g, "''")}').PlaySync()`,
        ]);
      } else {
        // Linux: try common audio players in order
        const player = await this.findAudioPlayer();
        if (player) {
          await execFileAsync(player, player === "paplay" ? [filePath] : ["-q", filePath]);
        } else {
          this.log.warn("No audio player found — file saved but cannot auto-play. Install aplay, paplay, or ffplay.");
        }
      }
    } catch (err) {
      this.log.warn(`Auto-play failed: ${err}`);
    }
  }

  private async findAudioPlayer(): Promise<string | null> {
    for (const cmd of ["aplay", "paplay", "ffplay"]) {
      if (await this.commandExists(cmd)) return cmd;
    }
    return null;
  }

  private async findLocalTTS(): Promise<string | null> {
    for (const cmd of ["espeak-ng", "espeak"]) {
      if (await this.commandExists(cmd)) return cmd;
    }
    return null;
  }

  // ─── Microphone Recording ──────────────────────────────────────────────

  private async recordAudio(args: Record<string, unknown>): Promise<ToolResult> {
    const duration = (args["duration"] as number) || 10;
    const silenceThreshold = (args["silence_threshold"] as number) || 2;
    const outputPath = join(tmpdir(), `myclaw-rec-${Date.now()}.wav`);
    const os = platform();

    try {
      const recorder = await this.findRecorder();
      if (!recorder) {
        const tips = os === "win32"
          ? "Install ffmpeg (winget install ffmpeg) or sox (winget install sox)."
          : os === "darwin"
            ? "Install sox (brew install sox) or ffmpeg (brew install ffmpeg)."
            : "Install alsa-utils (apt install alsa-utils), sox, or ffmpeg.";
        return {
          success: false,
          output: "",
          error: `No audio recorder found. ${tips}`,
        };
      }

      this.log.info(`Recording from mic using ${recorder} (max ${duration}s, silence stop: ${silenceThreshold}s)...`);

      if (recorder === "arecord") {
        // Linux ALSA — records WAV, stops after duration
        await execFileAsync("arecord", [
          "-f", "cd", "-t", "wav", "-d", String(duration),
          "-q", outputPath,
        ], { timeout: (duration + 2) * 1000 });
      } else if (recorder === "rec") {
        // SoX — has built-in silence detection
        await execFileAsync("rec", [
          outputPath, "rate", "16k", "channels", "1",
          "trim", "0", String(duration),
          "silence", "1", "0.1", "1%", "1", String(silenceThreshold), "1%",
        ], { timeout: (duration + 5) * 1000 });
      } else if (recorder === "ffmpeg") {
        // ffmpeg — platform-aware input device
        let inputDevice: string;
        let inputSource: string;
        if (os === "darwin") {
          inputDevice = "avfoundation";
          inputSource = ":0";
        } else if (os === "win32") {
          inputDevice = "dshow";
          inputSource = await this.detectDshowAudioDevice();
        } else {
          inputDevice = "pulse";
          inputSource = "default";
        }
        await execFileAsync("ffmpeg", [
          "-y", "-f", inputDevice, "-i", inputSource,
          "-t", String(duration), "-ar", "16000", "-ac", "1",
          "-loglevel", "error", outputPath,
        ], { timeout: (duration + 5) * 1000 });
      } else if (recorder === "powershell-recorder") {
        // Windows PowerShell fallback using NAudio-style recording via .NET
        const psScript = `
Add-Type -AssemblyName System.Speech
$recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine
$recognizer.SetInputToDefaultAudioDevice()
$grammar = New-Object System.Speech.Recognition.DictationGrammar
$recognizer.LoadGrammar($grammar)
$recognizer.InitialSilenceTimeout = [TimeSpan]::FromSeconds(${duration})
$recognizer.EndSilenceTimeout = [TimeSpan]::FromSeconds(${silenceThreshold})
try {
  $result = $recognizer.Recognize([TimeSpan]::FromSeconds(${duration}))
  if ($result) { Write-Output $result.Text }
  else { Write-Error 'No speech detected' }
} finally {
  $recognizer.Dispose()
}`;
        // This special recorder skips WAV and directly returns text
        const result = await execFileAsync("powershell", ["-NoProfile", "-Command", psScript], {
          timeout: (duration + 5) * 1000,
        });
        const text = result.stdout.trim();
        return {
          success: !!text,
          output: text || "No speech detected",
          data: { directText: true, text, engine: "windows-speech" },
        };
      }

      const { statSync } = await import("node:fs");
      const sizeBytes = statSync(outputPath).size;

      if (sizeBytes < 1000) {
        return { success: false, output: "", error: "Recording too short or empty — check your microphone." };
      }

      return {
        success: true,
        output: `Recorded audio: ${outputPath} (${(sizeBytes / 1024).toFixed(1)} KB)`,
        data: { path: outputPath, sizeBytes, durationMax: duration },
      };
    } catch (err) {
      return { success: false, output: "", error: `Recording failed: ${err}` };
    }
  }

  private async findRecorder(): Promise<string | null> {
    const os = platform();

    if (os === "win32") {
      // Windows: prefer PowerShell (always works, no device name needed),
      // then sox, then ffmpeg (dshow needs exact device name detection)
      return "powershell-recorder";
    } else if (os === "darwin") {
      if (await this.commandExists("rec")) return "rec";
      if (await this.commandExists("ffmpeg")) return "ffmpeg";
    } else {
      // Linux
      if (await this.commandExists("arecord")) return "arecord";
      if (await this.commandExists("rec")) return "rec";
      if (await this.commandExists("ffmpeg")) return "ffmpeg";
    }
    return null;
  }

  /**
   * Auto-detect the first audio input device for ffmpeg dshow on Windows.
   * Parses `ffmpeg -list_devices true -f dshow -i dummy` output.
   */
  private async detectDshowAudioDevice(): Promise<string> {
    try {
      // ffmpeg prints device list to stderr and exits with error code
      const result = await execFileAsync("ffmpeg", [
        "-list_devices", "true", "-f", "dshow", "-i", "dummy",
      ], { timeout: 5000 }).catch((err: { stderr?: string }) => ({ stdout: "", stderr: err.stderr || "" }));

      const output = (result as { stderr?: string }).stderr || "";
      // Look for lines like: [dshow] "Microphone (Realtek Audio)" (audio)
      const audioMatch = output.match(/\] "([^"]+)" \(audio\)/);
      if (audioMatch) {
        return `audio=${audioMatch[1]}`;
      }
    } catch {
      // fallback below
    }
    // Last resort: generic name
    return "audio=Microphone";
  }

  // ─── Live Voice Conversation ─────────────────────────────────────────────

  private async voiceChat(args: Record<string, unknown>): Promise<ToolResult> {
    if (!this.processMessage) {
      return { success: false, output: "", error: "Voice chat requires engine integration (processMessage not available)." };
    }

    // Check that at least some form of STT is available
    const hasSTT = this.openaiKey
      || await this.findLocalWhisper()
      || platform() === "win32";

    if (!hasSTT) {
      return {
        success: false,
        output: "",
        error: "No speech-to-text engine available for voice chat. Options:\n" +
          "  1. Set OPENAI_API_KEY for cloud Whisper\n" +
          "  2. Install whisper.cpp: https://github.com/ggerganov/whisper.cpp\n" +
          "  3. Install openai-whisper: pip install openai-whisper",
      };
    }

    const voice = (args["voice"] as string) || "alloy";
    const language = args["language"] as string | undefined;
    const stopWords = ["stop", "exit", "goodbye", "quit", "bye", "end conversation"];

    this.voiceChatActive = true;
    const transcript: Array<{ role: string; text: string }> = [];
    let turns = 0;
    const maxTurns = 50;

    this.log.info("Voice chat started — speak into your microphone. Say 'stop' or 'goodbye' to end.");
    console.log("\n[Voice Chat] Listening... (say 'stop' or 'goodbye' to end)\n");

    try {
      while (this.voiceChatActive && turns < maxTurns) {
        turns++;

        // Step 1: Record from mic
        const recResult = await this.recordAudio({ duration: 15, silence_threshold: 2 });
        if (!recResult.success) {
          this.log.warn(`Recording failed: ${recResult.error}`);
          console.log(`[Voice Chat] Could not record: ${recResult.error}`);
          break;
        }

        // Step 2: Transcribe — handle direct-text recorders (Windows Speech)
        let userText: string;
        const recData = recResult.data as Record<string, unknown>;

        if (recData?.directText) {
          // PowerShell recorder already returns text directly
          userText = (recData.text as string || "").trim();
        } else {
          const audioPath = recData.path as string;
          const transcription = await this.transcribe({ url: audioPath, language });
          if (!transcription.success) {
            this.log.warn(`Transcription failed: ${transcription.error}`);
            console.log("[Voice Chat] Could not understand audio, try again...");
            continue;
          }
          userText = transcription.output.trim();
        }

        if (!userText) {
          console.log("[Voice Chat] No speech detected, listening again...");
          continue;
        }

        console.log(`[You] ${userText}`);
        transcript.push({ role: "user", text: userText });

        // Step 3: Check for stop words
        if (stopWords.some((w) => userText.toLowerCase().includes(w))) {
          console.log("[Voice Chat] Ending conversation. Goodbye!");
          await this.synthesize({ text: "Goodbye! It was nice talking with you.", voice });
          this.voiceChatActive = false;
          break;
        }

        // Step 4: Get agent response
        const response = await this.processMessage(userText, "voice-user", "voice-chat");

        console.log(`[MyClaw] ${response}`);
        transcript.push({ role: "assistant", text: response });

        // Step 5: Speak the response
        await this.synthesize({ text: response, voice });
      }

      return {
        success: true,
        output: `Voice conversation ended after ${turns} turn(s).`,
        data: { turns, transcript },
      };
    } catch (err) {
      this.voiceChatActive = false;
      return { success: false, output: "", error: `Voice chat error: ${err}` };
    } finally {
      this.voiceChatActive = false;
    }
  }

  // ─── Language Detection ─────────────────────────────────────────────────

  private async detectLanguage(args: Record<string, unknown>): Promise<ToolResult> {
    const url = args["url"] as string;

    if (!this.openaiKey) {
      return { success: false, output: "", error: "OPENAI_API_KEY not set (language detection requires Whisper API)" };
    }

    try {
      const audioData = await this.fetchAudio(url);

      const formData = new FormData();
      formData.append("file", new Blob([audioData]), "audio.ogg");
      formData.append("model", "whisper-1");
      formData.append("response_format", "verbose_json");

      const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${this.openaiKey}` },
        body: formData,
      });

      if (!res.ok) {
        const err = await res.text();
        return { success: false, output: "", error: `Whisper API error: ${err}` };
      }

      const data = (await res.json()) as { language: string; text: string };
      return {
        success: true,
        output: `Language: ${data.language}\nTranscription: ${data.text}`,
        data: { language: data.language, text: data.text },
      };
    } catch (err) {
      return { success: false, output: "", error: `Language detection failed: ${err}` };
    }
  }

  // ─── Utilities ─────────────────────────────────────────────────────────

  private async fetchAudio(urlOrPath: string): Promise<Buffer> {
    if (urlOrPath.startsWith("http://") || urlOrPath.startsWith("https://")) {
      const res = await fetch(urlOrPath);
      return Buffer.from(await res.arrayBuffer());
    }

    const { readFile } = await import("node:fs/promises");
    return readFile(urlOrPath);
  }
}
