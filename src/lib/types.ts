export type PipelineType = 'no_context' | 'full_context' | 'rag' | 'baseline';

export interface GroundedSentence {
	text: string;
	grounded: boolean;
	score: number;
	reason: string;
}

export interface PositionBin {
	bin: number;
	rangeLabel: string;
	hits: number;
}

export interface HallucinationFlag {
	claim: string;
	reason: string;
}

export interface Citation {
	chunkOrder: number;
	text: string;
}

export interface PipelineRun {
	pipeline: PipelineType;
	modelFamily: string;
	modelName: string;
	provider: string;
	answer: string;
	confidence: number;
	hallucinationCount: number;
	hallucinations: HallucinationFlag[];
	sentences: GroundedSentence[];
	citations: Citation[];
	positionBins: PositionBin[];
	contextChars: number;
	contextChunks: number;
	contextCoverage: number;
	noiseInjected: boolean;
	latencyMs: number;
	sessionId?: string;
	sessionName?: string;
	createdAt?: number;
	query?: string;
}

export interface SessionSummary {
	_id: string;
	title?: string;
	filename: string;
	previewText: string;
	createdAt: number;
}

export interface UploadedDocument {
	title?: string;
	filename: string;
	previewText: string;
	text: string;
}

export interface AnalysisStreamEvent {
	type: 'status' | 'run' | 'done' | 'error';
	message?: string;
	run?: PipelineRun;
	progress?: number;
	model?: string;
	stats?: {
		hallucinationDelta: number;
		confidenceDelta: number;
	};
	error?: string;
}
