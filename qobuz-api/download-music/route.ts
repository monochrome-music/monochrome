import { NextRequest, NextResponse } from 'next/server';
import { getDownloadURL } from '@/lib/qobuz-dl-server';
import z from 'zod';

const downloadParamsSchema = z.object({
    track_id: z.preprocess((a) => parseInt(a as string), z.number().min(0, 'ID must be 0 or greater').default(1)),
    quality: z.enum(['27', '7', '6', '5']).default('27')
});

export async function GET(request: NextRequest) {
    const country = request.headers.get('Token-Country');
    const params = Object.fromEntries(new URL(request.url).searchParams.entries());
    try {
        const { track_id, quality } = downloadParamsSchema.parse(params);
        const url = await getDownloadURL(track_id, quality, country ? { country } : {});
        return new NextResponse(JSON.stringify({ success: true, data: { url } }), { status: 200 });
    } catch (error: any) {
        return new NextResponse(
            JSON.stringify({
                success: false,
                error: error?.errors || error.message || 'An error occurred parsing the request.'
            }),
            { status: 400 }
        );
    }
}
