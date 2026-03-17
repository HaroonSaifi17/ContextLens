import { DOMMatrix } from '@napi-rs/canvas';
import * as pdfjsWorker from 'pdfjs-dist/legacy/build/pdf.worker.mjs';

if (!globalThis.DOMMatrix) {
	globalThis.DOMMatrix = DOMMatrix as typeof globalThis.DOMMatrix;
}

const globalWithPdfWorker = globalThis as typeof globalThis & {
	pdfjsWorker?: { WorkerMessageHandler?: unknown };
};

if (!globalWithPdfWorker.pdfjsWorker?.WorkerMessageHandler) {
	globalWithPdfWorker.pdfjsWorker = pdfjsWorker;
}

const pdfjsLibPromise = import('pdfjs-dist/legacy/build/pdf.mjs');

function normalizeWhitespace(text: string) {
	return text.replace(/\s+/g, ' ').trim();
}

async function extractPdfText(data: Uint8Array) {
	const pdfjsLib = await pdfjsLibPromise;
	const loadingTask = pdfjsLib.getDocument({
		data,
		isEvalSupported: false,
		useSystemFonts: false
	});

	const document = await loadingTask.promise;
	const pages: string[] = [];

	for (let index = 1; index <= document.numPages; index += 1) {
		const page = await document.getPage(index);
		const content = await page.getTextContent();
		const text = content.items
			.map((item) => ('str' in item ? item.str : ''))
			.join(' ')
			.trim();
		if (text) {
			pages.push(text);
		}
	}

	return pages.join('\n\n');
}

export async function extractDocumentText(file: File) {
	const lowerName = file.name.toLowerCase();

	if (lowerName.endsWith('.pdf') || file.type === 'application/pdf') {
		const bytes = new Uint8Array(await file.arrayBuffer());
		return normalizeWhitespace(await extractPdfText(bytes));
	}

	return normalizeWhitespace(await file.text());
}
