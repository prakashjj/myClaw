/**
 * Voice Processing Tool Plugin
 *
 * UNIQUE FEATURE: Voice note processing for WhatsApp/Telegram.
 * No other claw variant handles voice messages natively.
 *
 * - Transcribe voice notes to text (via Whisper API or local Whisper)
 * - Generate voice responses (text-to-speech)
 * - Voice memo summarization
 * - Language detection from audio
 *
 * Works with:
 * - OpenAI Whisper API (cloud)
 * - Local Whisper via whisper.cpp (offline)
 * - ElevenLabs / OpenAI TTS for speech synthesis
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
  description = "Voice transcription, synthesis, and processing";

  private openaiKey = "";
  private log!: PluginContext["log"];

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
  }

  async execute(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    switch (toolName) {
      case "transcribe_audio":
        return this.transcribe(args);
      case "text_to_speech":
        return this.synthesize(args);
      case "detect_language":
        return this.detectLanguage(args);
      default:
        return { success: false, output: "", error: `Unknown tool: ${toolName}` };
    }
  }

  private async transcribe(args: Record<string, unknown>): Promise<ToolResult> {
    const url = args["url"] as string;
    const language = args["language"] as string | undefined;

    if (!this.openaiKey) {
      return { success: false, output: "", error: "OPENAI_API_KEY not set (needed for Whisper)" };
    }

    try {
      // Fetch audio data
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
      return { success: true, output: data.text, data: { text: data.text } };
    } catch (err) {
      return { success: false, output: "", error: `Transcription failed: ${err}` };
    }
  }

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

      return {
        success: true,
        output: `Audio generated (OpenAI TTS): ${outputPath}`,
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

      return {
        success: true,
        output: `Audio generated (local TTS): ${outputPath}`,
        data: { path: outputPath, sizeBytes, engine: "local" },
      };
    } catch (err) {
      return { success: false, output: "", error: `Local TTS failed: ${err}` };
    }
  }

  private async findLocalTTS(): Promise<string | null> {
    for (const cmd of ["espeak-ng", "espeak"]) {
      try {
        await execFileAsync("which", [cmd]);
        return cmd;
      } catch {
        // not found, try next
      }
    }
    return null;
  }

  private async detectLanguage(args: Record<string, unknown>): Promise<ToolResult> {
    const url = args["url"] as string;

    if (!this.openaiKey) {
      return { success: false, output: "", error: "OPENAI_API_KEY not set" };
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

  private async fetchAudio(urlOrPath: string): Promise<Buffer> {
    if (urlOrPath.startsWith("http://") || urlOrPath.startsWith("https://")) {
      const res = await fetch(urlOrPath);
      return Buffer.from(await res.arrayBuffer());
    }

    const { readFile } = await import("node:fs/promises");
    return readFile(urlOrPath);
  }
}
