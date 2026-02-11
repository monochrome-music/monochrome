import { getArtist } from '@/lib/qobuz-dl-server';
import z from 'zod';

const artistReleasesParamsSchema = z.object({
    artist_id: z.string().min(1, 'ID is required')
});

export async function GET(request: Request) {
    const country = request.headers.get('Token-Country');
    const params = Object.fromEntries(new URL(request.url).searchParams.entries());
    try {
        const { artist_id } = artistReleasesParamsSchema.parse(params);
        const artist = await getArtist(artist_id, country ? { country } : {});
        return new Response(JSON.stringify({ success: true, data: { artist } }), { status: 200 });
    } catch (error: any) {
        return new Response(
            JSON.stringify({
                success: false,
                error: error?.errors || error.message || 'An error occurred parsing the request.'
            }),
            { status: 400 }
        );
    }
}
