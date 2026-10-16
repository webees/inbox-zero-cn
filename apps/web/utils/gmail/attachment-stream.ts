import { parser } from "stream-json/web";

type Token = parser.Token;

export function decodeGmailAttachmentStream(
  source: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): ReadableStream<Uint8Array> {
  signal?.throwIfAborted();
  let depth = 0;
  let expectingData = false;
  let inData = false;
  let foundData = false;
  let remainder = "";
  let padding = false;
  const tokens = (source as unknown as ReadableStream<BufferSource>)
    // TextDecoderStream 接受任何 BufferSource，但 ReadableStream 在
    // 这里是不可变的，因此需要显式声明更宽的输入类型。
    .pipeThrough(new TextDecoderStream(), { signal })
    .pipeThrough(
      parser.asWebStream({
        packStrings: false,
        packNumbers: false,
        packKeys: true,
        streamKeys: false,
      }),
      { signal },
    );
  return tokens.pipeThrough(
    new TransformStream<Token, Uint8Array>({
      transform(token, controller) {
        if (expectingData) {
          if (token.name !== "startString") throw new Error("无效的附件数据");
          expectingData = false;
          inData = true;
          return;
        }
        if (token.name === "startObject" || token.name === "startArray")
          depth++;
        if (token.name === "endObject" || token.name === "endArray") depth--;
        if (
          depth === 1 &&
          token.name === "keyValue" &&
          token.value === "data"
        ) {
          if (foundData) throw new Error("重复的附件数据");
          foundData = true;
          expectingData = true;
        } else if (inData && token.name === "stringChunk") {
          if (!/^[A-Za-z0-9_=-]*$/.test(token.value))
            throw new Error("无效的附件编码");
          remainder += token.value;
          const index = remainder.indexOf("=");
          if (index !== -1) padding = true;
          const length = padding
            ? Math.floor(index / 4) * 4
            : Math.floor(remainder.length / 4) * 4;
          if (length > 0) {
            controller.enqueue(
              new Uint8Array(
                Buffer.from(remainder.slice(0, length), "base64url"),
              ),
            );
            remainder = remainder.slice(length);
          }
          if (
            padding &&
            (remainder.length > 4 || !/^[A-Za-z0-9_-]*={1,2}$/.test(remainder))
          )
            throw new Error("无效的附件填充");
        } else if (inData && token.name === "endString") {
          const bytes = Buffer.from(remainder, "base64url");
          if (
            remainder.length === 1 ||
            bytes.toString("base64url") !== remainder.replace(/=+$/, "") ||
            (padding && remainder.length !== 4)
          )
            throw new Error("无效的附件编码");
          if (bytes.length) controller.enqueue(new Uint8Array(bytes));
          remainder = "";
          inData = false;
        }
      },
      flush() {
        if (!foundData || inData || expectingData)
          throw new Error("缺少附件数据");
      },
    }),
    { signal },
  );
}
