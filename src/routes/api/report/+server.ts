import { json, type RequestHandler } from '@sveltejs/kit';
import { buildReliabilityReport } from '$lib/server/report';

export const GET: RequestHandler = async ({ url }) => {
	try {
		const report = await buildReliabilityReport();
		if (url.searchParams.get('format') === 'latex') {
			return new Response(
				`${report.latexTables.variables}\n\n${report.latexTables.pairedUplift}\n\n${report.latexTables.reliabilityPatterns}\n`,
				{
					headers: {
						'Content-Type': 'text/plain; charset=utf-8',
						'Content-Disposition': `attachment; filename="contextlens-latex-${Date.now()}.tex"`
					}
				}
			);
		}
		return json(report);
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to build report.';
		return json({ error: message }, { status: 500 });
	}
};
