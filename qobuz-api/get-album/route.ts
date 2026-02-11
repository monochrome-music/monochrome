import { NextRequest, NextResponse } from 'next/server';
import { getAlbumInfo } from '@/lib/qobuz-dl-server';
import z from 'zod';

const albumInfoParamsSchema = z.object({
    album_id: z.string().min(1, 'ID is required')
});

export async function GET(request: NextRequest) {
    const country = request.headers.get('Token-Country');
    const params = Object.fromEntries(new URL(request.url).searchParams.entries());
    try {
        const { album_id } = albumInfoParamsSchema.parse(params);
        const data = await getAlbumInfo(album_id, country ? { country } : {});
        return new NextResponse(JSON.stringify({ success: true, data }), { status: 200 });
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
