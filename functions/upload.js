const API_BASE = "https://temp.imgur.gg/api/upload";
const COMPLETE_URL = "https://temp.imgur.gg/api/upload/complete";
const PING_URL = "https://temp.imgur.gg/api/ping";

export async function onRequest(context) {
    const { request } = context;

    if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (request.method !== "POST") {
        return jsonError("Method not allowed", 405);
    }

    try {
        const contentType = request.headers.get("content-type") || "";
        let file;
        let fileName;
        let fileType;

        /* ========================= */
        /*        GET FILE           */
        /* ========================= */

        if (contentType.includes("application/json")) {
            const body = await request.json();
            if (!body.fileUrl) return jsonError("No fileUrl provided", 400);

            const res = await fetch(body.fileUrl);
            if (!res.ok) throw new Error("Failed to fetch remote file");

            file = await res.arrayBuffer();
            fileName = body.fileName || body.fileUrl.split("/").pop();
            fileType = res.headers.get("content-type") || "application/octet-stream";
        } else {
            const form = await request.formData();
            const uploaded = form.get("file");
            if (!uploaded) return jsonError("No file provided", 400);

            if (uploaded.size > 500 * 1024 * 1024) {
                return jsonError("File exceeds 500MB", 400);
            }

            file = await uploaded.arrayBuffer();
            fileName = uploaded.name;
            fileType = uploaded.type || "application/octet-stream";
        }

        /* ========================= */
        /*        GET SESSION        */
        /* ========================= */

        const ping = await fetch(PING_URL, {
            method: "GET",
            headers: userAgentHeaders()
        });

        const setCookie = ping.headers.get("set-cookie") || "";
        const sessionCookie =
            setCookie.split(";").find(c => c.trim().startsWith("_s=")) || "";

        /* ========================= */
        /*       GET METADATA        */
        /* ========================= */

        const metadataResp = await fetch(API_BASE, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Cookie": sessionCookie,
                ...userAgentHeaders()
            },
            body: JSON.stringify({
                files: [
                    {
                        fileName,
                        fileType,
                        fileSize: file.byteLength
                    }
                ]
            })
        });

        const metadataText = await metadataResp.text();

        if (!metadataResp.ok) {
            throw new Error(`Metadata failed: ${metadataText}`);
        }

        const metadata = JSON.parse(metadataText);
        const fileInfo = metadata.files?.[0];

        if (!fileInfo || !fileInfo.success) {
            throw new Error("Invalid metadata response");
        }

        /* ========================= */
        /*      HANDLE UPLOAD        */
        /* ========================= */

        let result;

        if (fileInfo.isMultipart) {
            result = await handleMultipart(fileInfo, file, sessionCookie);
        } else {
            result = await handleSingle(fileInfo.uploadUrl, file, fileType);
        }

        const publicUrl = `https://i.imgur.gg/${fileInfo.fileId}-${fileInfo.fileName}`;

        return jsonResponse({
            success: true,
            url: publicUrl,
            fileId: fileInfo.fileId,
            fileName: fileInfo.fileName
        });

    } catch (err) {
        return jsonError(err.message, 500);
    }
}

/* ===================================================== */
/* ================= SINGLE UPLOAD ===================== */
/* ===================================================== */

async function handleSingle(uploadUrl, fileBuffer, fileType) {
    if (!uploadUrl) throw new Error("Missing uploadUrl");

    const res = await fetch(uploadUrl, {
        method: "PUT",
        body: fileBuffer,
        headers: {
            "Content-Type": fileType
        }
    });

    if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Single upload failed: ${txt}`);
    }

    return true;
}

/* ===================================================== */
/* ================= MULTIPART UPLOAD =================== */
/* ===================================================== */

async function handleMultipart(fileInfo, fileBuffer, sessionCookie) {
    const { partUrls, partSize, uploadId, fileId } = fileInfo;

    if (!partUrls || !uploadId) {
        throw new Error("Invalid multipart metadata");
    }

    const parts = [];

    for (let i = 0; i < partUrls.length; i++) {
        const start = i * partSize;
        const end = start + partSize;
        const chunk = fileBuffer.slice(start, end);

        const uploadRes = await fetch(partUrls[i].url, {
            method: "PUT",
            body: chunk
        });

        if (!uploadRes.ok) {
            const txt = await uploadRes.text();
            throw new Error(`Multipart part ${i + 1} failed: ${txt}`);
        }

        let etag = uploadRes.headers.get("etag") || "";
        etag = etag.replace(/"/g, "");

        parts.push({
            PartNumber: i + 1,
            ETag: `"${etag}"`
        });
    }

    /* ========================= */
    /*      FINALIZE UPLOAD      */
    /* ========================= */

    const completeResp = await fetch(COMPLETE_URL, {
        method: "PUT",
        headers: {
            "Content-Type": "application/json",
            "Cookie": sessionCookie,
            ...userAgentHeaders()
        },
        body: JSON.stringify({
            fileId,
            uploadId,
            parts
        })
    });

    const completeText = await completeResp.text();

    if (!completeResp.ok) {
        throw new Error(`Multipart complete failed: ${completeText}`);
    }

    const completeData = JSON.parse(completeText);

    if (!completeData.success) {
        throw new Error("Multipart finalize returned failure");
    }

    return completeData;
}

/* ===================================================== */
/* ================= UTILITIES ========================= */
/* ===================================================== */

function jsonResponse(obj, status = 200) {
    return new Response(JSON.stringify(obj), {
        status,
        headers: {
            "Content-Type": "application/json",
            ...corsHeaders()
        }
    });
}

function jsonError(message, status) {
    return jsonResponse({ success: false, error: message }, status);
}

function corsHeaders() {
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "*"
    };
}

function userAgentHeaders() {
    return {
        "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0"
    };
}
