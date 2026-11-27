import { NextResponse } from "next/server";

export async function readRequestJson(
  request: Request,
): Promise<{ json: unknown } | { response: NextResponse }> {
  try {
    return { json: await request.json() };
  } catch {
    return {
      response: NextResponse.json(
        { error: "无效的 JSON 请求体", isKnownError: true },
        { status: 400 },
      ),
    };
  }
}
