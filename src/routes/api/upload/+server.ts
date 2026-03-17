import { json, type RequestHandler } from '@sveltejs/kit';
import { extractDocumentText } from '$lib/server/document';

export const config = {
	maxDuration: 60
};

function makeTitle(filename: string, text: string) {
	const cleanName = filename
		.replace(/\.[^.]+$/, '')
		.replace(/[_-]+/g, ' ')
		.trim();
	const firstSentence = text
		.split(/(?<=[.!?])\s+/)
		.map((line) => line.trim())
		.find((line) => line.length > 20);

	if (!firstSentence) {
		return cleanName || 'Untitled Session';
	}

	const concise = firstSentence.slice(0, 72).trim();
	if (cleanName) {
		return `${cleanName} - ${concise}`;
	}
	return concise;
}

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

		const title = makeTitle(file.name, text);
		const previewText = text.slice(0, 4000);

		return json({
			document: {
				title,
				filename: file.name,
				previewText,
				text
			}
		});
	} catch (error) {
		console.error('[upload] failed', error);
		const message = error instanceof Error ? error.message : 'Upload failed.';
		return json({ error: message }, { status: 500 });
	}
};
