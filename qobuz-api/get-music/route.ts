import { NextRequest, NextResponse } from 'next/server';
import { search } from '@/lib/qobuz-dl-server';
import z from 'zod';

const searchParamsSchema = z.object({
    q: z.string().min(1, 'Query is required'),
    offset: z.preprocess((a) => parseInt(a as string), z.number().max(1000, 'Offset must be less than 1000').min(0, 'Offset must be 0 or greater').default(0))
});

export async function GET(request: NextRequest) {
    const country = request.headers.get('Token-Country');
    const params = Object.fromEntries(new URL(request.url).searchParams.entries());
    try {
        const { q, offset } = searchParamsSchema.parse(params);
        const searchResults = await search(q, 10, offset, country ? { country } : {});
        return new NextResponse(JSON.stringify({ success: true, data: searchResults }), { status: 200 });
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
