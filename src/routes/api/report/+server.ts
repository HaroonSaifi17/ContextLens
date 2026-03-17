import { json, type RequestHandler } from '@sveltejs/kit';
import { buildReliabilityReport } from '$lib/server/report';

export const GET: RequestHandler = async () => {
	try {
		return json(await buildReliabilityReport());
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to build report.';
		return json({ error: message }, { status: 500 });
	}
};
