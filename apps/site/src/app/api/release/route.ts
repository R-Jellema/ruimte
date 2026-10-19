import { availablePlatforms, fetchLatestRelease } from '@/lib/release.ts';

export const dynamic = 'force-dynamic';

export async function GET() {
    const release = await fetchLatestRelease();
    if (!release) {
        return Response.json({ error: 'No release' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
    }
    return Response.json(
        { version: release.version, publishedAt: release.publishedAt, platforms: availablePlatforms(release) },
        { headers: { 'Cache-Control': 'public, max-age=300' } }
    );
}
