import { json, type RequestHandler } from '@sveltejs/kit';
import { extractDocumentText } from '$lib/server/document';
import { convexClient, convexFunctions } from '$lib/server/convex';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const formData = await request.formData();
		const file = formData.get('file');

		if (!(file instanceof File)) {
			return json({ error: 'No file was uploaded.' }, { status: 400 });
		}

		if (file.size > 20 * 1024 * 1024) {
			return json({ error: 'File is too large. Maximum supported size is 20MB.' }, { status: 400 });
		}

		const text = await extractDocumentText(file);
		if (!text) {
			return json({ error: 'Could not extract text from this file.' }, { status: 400 });
		}

		const client = convexClient();
		const result = await client.mutation(convexFunctions.createSession, {
			filename: file.name,
			text
		});

		return json({
			session: {
				_id: String(result.sessionId),
				filename: result.filename,
				previewText: result.previewText,
				createdAt: result.createdAt
			}
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Upload failed.';
		return json({ error: message }, { status: 500 });
	}
};
