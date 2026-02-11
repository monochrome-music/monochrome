import { tokenCountriesMap, TokenCountry } from '@/config/token-countries';
import { NextResponse } from 'next/server';

export async function GET() {
    if (tokenCountriesMap.length === 0) {
        return new NextResponse(
            JSON.stringify({
                success: false,
                error: 'No countries list found'
            })
        );
    }
    try {
        const countryCodes: string[] = tokenCountriesMap.map((country: TokenCountry) => country.code);
        return new NextResponse(
            JSON.stringify({
                success: true,
                data: countryCodes
            })
        );
    } catch {
        return new NextResponse(
            JSON.stringify({
                success: false,
                error: 'Error parsing the countries list'
            })
        );
    }
}
