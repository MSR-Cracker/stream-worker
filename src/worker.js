export default {
  async fetch(request) {
    const reqUrl = new URL(request.url);

    // 1. التعامل مع طلبات CORS (Preflight)
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
          "Access-Control-Allow-Headers": "*",
        },
      });
    }

    const targetUrl = reqUrl.searchParams.get("url");
    const referer = reqUrl.searchParams.get("ref") || "https://egybestvid.com/";

    if (!targetUrl) {
      return new Response("Missing 'url' parameter", { status: 400 });
    }

    try {
      const origin = new URL(referer).origin;

      // 2. إرسال الطلب للسيرفر الأصلي مع حقن الهيدرز
      const response = await fetch(targetUrl, {
        method: request.method,
        headers: {
          "Referer": referer,
          "Origin": origin,
          "User-Agent": request.headers.get("User-Agent") || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      });

      const contentType = response.headers.get("content-type") || "";
      const isM3U8 =
        targetUrl.includes(".m3u8") ||
        contentType.includes("mpegurl") ||
        contentType.includes("vnd.apple.mpegurl");

      // 3. إذا كان الملف m3u8، نعيد كتابة الروابط الداخلية لتمر عبر البروكسي
      if (isM3U8 && response.ok) {
        const text = await response.text();
        const proxyBase = `${reqUrl.origin}${reqUrl.pathname}`;
        const encodedRef = encodeURIComponent(referer);

        const rewritten = text
          .split("\n")
          .map((line) => {
            const trimmed = line.trim();
            if (!trimmed) return line;

            // إعادة كتابة الروابط داخل وسوم HLS مثل مفاتيح التشفير أو الصوت (URI="...")
            if (trimmed.startsWith("#")) {
              return line.replace(/URI="([^"]+)"/g, (_, uri) => {
                const absUrl = new URL(uri, targetUrl).href;
                return `URI="${proxyBase}?url=${encodeURIComponent(absUrl)}&ref=${encodedRef}"`;
              });
            }

            // إعادة كتابة روابط القوائم الفرعية وأجزاء الفيديو (.ts)
            const absUrl = new URL(trimmed, targetUrl).href;
            return `${proxyBase}?url=${encodeURIComponent(absUrl)}&ref=${encodedRef}`;
          })
          .join("\n");

        return new Response(rewritten, {
          status: response.status,
          headers: {
            "Content-Type": "application/vnd.apple.mpegurl",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-cache",
          },
        });
      }

      // 4. إذا كان ملف فيديو (.ts) أو أي ملف آخر، نمرره كبث مباشر (Stream)
      const newHeaders = new Headers(response.headers);
      newHeaders.set("Access-Control-Allow-Origin", "*");
      newHeaders.delete("content-security-policy");

      return new Response(response.body, {
        status: response.status,
        headers: newHeaders,
      });
    } catch (err) {
      return new Response(`Proxy Error: ${err.message}`, { status: 500 });
    }
  },
};
