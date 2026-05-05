// Ko-fi webhook handler | by uzif (God i fucking love claude)


// how to run this stupid shit:
// Configure the webhook URL in your Ko-fi settings: https://ko-fi.com/manage/webhooks
// Set the URL to: https://monochrome.tf/api/kofi-webhook
// Set KOFI_VERIFICATION_TOKEN in your Cloudflare Pages environment variables
// Bind a KV namespace named DONORS_KV in your Cloudflare Pages settings


const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
};

export async function onRequestOptions() {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestPost(context) {
    const { request, env } = context;

    try {
        const formData = await request.formData();
        const raw = formData.get('data');
        if (!raw) {
            return new Response(JSON.stringify({ error: 'Missing data' }), {
                status: 400,
                headers: CORS_HEADERS,
            });
        }

        const donation = JSON.parse(raw);

        if (env.KOFI_VERIFICATION_TOKEN && donation.verification_token !== env.KOFI_VERIFICATION_TOKEN) {
            return new Response(JSON.stringify({ error: 'Invalid verification token' }), {
                status: 401,
                headers: CORS_HEADERS,
            });
        }

        if (!donation.is_public) {
            return new Response(JSON.stringify({ ok: true, skipped: 'private' }), {
                status: 200,
                headers: CORS_HEADERS,
            });
        }

        const donor = {
            name: donation.from_name || 'Anonymous',
            type: donation.is_subscription_payment ? 'monthly' : 'once',
            timestamp: donation.timestamp || new Date().toISOString(),
        };

        if (!env.DONORS_KV) {
            return new Response(JSON.stringify({ ok: true, stored: false, reason: 'KV not configured' }), {
                status: 200,
                headers: CORS_HEADERS,
            });
        }

        const existing = JSON.parse((await env.DONORS_KV.get('donors').catch(() => null)) || '[]');

        const idx = existing.findIndex((d) => d.name === donor.name);
        if (idx >= 0) {
            if (donor.type === 'monthly') existing[idx].type = 'monthly';
            existing[idx].timestamp = donor.timestamp;
        } else {
            existing.unshift(donor);
        }

        //modify the values to show more or less ocntributors (0, 100)
        await env.DONORS_KV.put('donors', JSON.stringify(existing.slice(0, 100)));

        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: CORS_HEADERS });
    } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS_HEADERS });
    }
}
