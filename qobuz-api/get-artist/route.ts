import { NextRequest, NextResponse } from 'next/server';
import { getArtist } from '@/lib/qobuz-dl-server';
import z from 'zod';

const artistParamsSchema = z.object({
    artist_id: z.string().min(1, 'ID is required'),
});

export async function GET(request: NextRequest) {
    const country = request.headers.get('Token-Country');
    const params = Object.fromEntries(new URL(request.url).searchParams.entries());
    try {
        const { artist_id } = artistParamsSchema.parse(params);
        const data = await getArtist(artist_id, country ? { country } : {});
        return new NextResponse(JSON.stringify({ success: true, data }), { status: 200 });
    } catch (error: any) {
        return new NextResponse(
            JSON.stringify({
                success: false,
                error: error?.errors || error.message || 'An error occurred parsing the request.',
            }),
            { status: 400 }
        );
    }
}
