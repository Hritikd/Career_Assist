import { NextRequest, NextResponse } from "next/server";
import { SarvamError, transcribeAudio } from "@/lib/sarvam";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: "Audio file required." }, { status: 400 });
    }
    if (file.size < 500) {
      return NextResponse.json(
        {
          error: "Recording was too short or empty. Tap to talk, speak, then stop.",
          code: "empty_audio",
        },
        { status: 400 }
      );
    }
    if (file.size > 3_500_000) {
      return NextResponse.json(
        { error: "Audio too large. Keep recordings under 20 seconds." },
        { status: 400 }
      );
    }
    const name =
      (typeof (file as File).name === "string" && (file as File).name) ||
      "recording.webm";
    const transcript = await transcribeAudio(file, name);
    return NextResponse.json({ transcript });
  } catch (err) {
    if (err instanceof SarvamError) {
      const status =
        err.status >= 400 && err.status < 600 ? err.status : 502;
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status }
      );
    }
    return NextResponse.json(
      { error: "Transcription failed. Please type instead." },
      { status: 502 }
    );
  }
}
