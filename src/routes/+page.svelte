<script lang="ts">
	import Header from '$lib/components/Header.svelte';
	import DocumentPanel from '$lib/components/DocumentPanel.svelte';
	import ModelResult from '$lib/components/ModelResult.svelte';
	import AnalyticsPanel from '$lib/components/AnalyticsPanel.svelte';
	import { Tabs, TabsContent, TabsList, TabsTrigger } from '$lib/components/ui/tabs';
	import { Button } from '$lib/components/ui/button';
	import { ListTree, LayoutGrid, Clock, FlaskConical, WandSparkles, Rows3 } from 'lucide-svelte';
	import { goto, replaceState } from '$app/navigation';
	import { browser } from '$app/environment';
	import type {
		AnalysisStreamEvent,
		PipelineRun,
		SessionSummary,
		UploadedDocument
	} from '$lib/types';

	let query = $state('');
	let activeTab = $state<'outputs' | 'analytics' | 'benchmarking' | 'history'>('outputs');
	let session = $state<SessionSummary | null>(null);
	let sessions = $state<SessionSummary[]>([]);
	let isUploading = $state(false);
	let isAnalyzing = $state(false);
	let isGeneratingQueries = $state(false);
	let noiseInjection = $state(false);
	let statusText = $state('Upload or paste a document to begin.');
	let runStatusText = $state('');
	let runs = $state<PipelineRun[]>([]);
	let allRuns = $state<PipelineRun[]>([]);
	let pendingDocument = $state<UploadedDocument | null>(null);
	let generatedQueries = $state<string[]>([]);
	let skipHashRestore = $state(false);

	const historyItems = $derived(
		sessions.map((item) => ({
			id: item._id,
			title: `[${item._id.slice(-4)}] ${item.title || item.filename}`,
			filename: item.filename,
			createdAt: new Date(item.createdAt).toLocaleString()
		}))
	);

	const batchQueries = $derived(
		generatedQueries.length > 0
			? generatedQueries
			: query
					.split('\n')
					.map((item) => item.trim())
					.filter(Boolean)
	);

	const currentQueryRuns = $derived.by(() => {
		const activeQuery = query.trim();
		if (!activeQuery) return runs;
		const filtered = runs.filter((run) => run.query === activeQuery);
		return filtered.length > 0 ? filtered : [];
	});

	const batchRunCount = $derived.by(() => {
		const querySet = new Set(batchQueries);
		return runs.filter((run) => querySet.has(run.query ?? '')).length;
	});

	async function refreshSessions() {
		const response = await fetch('/api/sessions');
		if (!response.ok) return;
		const payload = (await response.json()) as { sessions: SessionSummary[] };
		sessions = payload.sessions;
	}

	async function refreshAllRuns() {
		const response = await fetch('/api/runs');
		if (!response.ok) return;
		const payload = (await response.json()) as { runs: PipelineRun[] };
		allRuns = payload.runs;
	}

	async function loadSessionRuns(sessionId: string) {
		const response = await fetch(`/api/sessions/${sessionId}/runs`);
		if (!response.ok) {
			runs = [];
			return;
		}
		const payload = (await response.json()) as { runs: PipelineRun[] };
		runs = payload.runs;
	}

	async function handleUpload(file: File) {
		isUploading = true;
		statusText = 'Reading and preparing document...';
		try {
			const formData = new FormData();
			formData.append('file', file);
			const response = await fetch('/api/upload', { method: 'POST', body: formData });
			const payload = (await response.json()) as { document?: UploadedDocument; error?: string };
			if (!response.ok || !payload.document) throw new Error(payload.error ?? 'Upload failed.');
			pendingDocument = payload.document;
			generatedQueries = [];
			session = {
				_id: 'pending',
				title: payload.document.title,
				filename: payload.document.filename,
				previewText: payload.document.previewText,
				createdAt: Date.now()
			};
			query = '';
			runs = [];
			statusText = 'Document ready. Session will be saved when you run your first query.';
		} catch (error) {
			statusText = error instanceof Error ? error.message : 'Upload failed.';
		} finally {
			isUploading = false;
		}
	}

	async function handlePasteText(text: string, title: string) {
		const file = new File([text], title, { type: 'text/plain' });
		await handleUpload(file);
	}

	function parseSSEChunks(buffer: string) {
		const events = buffer.split('\n\n');
		return { events: events.slice(0, -1), remainder: events.at(-1) ?? '' };
	}

	async function ensureSavedSession() {
		if (!pendingDocument) {
			return session;
		}
		statusText = 'Saving session and indexing chunks...';
		const createSessionResponse = await fetch('/api/sessions', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				filename: pendingDocument.filename,
				text: pendingDocument.text
			})
		});

		const createSessionPayload = (await createSessionResponse.json()) as {
			session?: SessionSummary;
			error?: string;
		};
		if (!createSessionResponse.ok || !createSessionPayload.session) {
			throw new Error(createSessionPayload.error ?? 'Failed to save session.');
		}

		session = createSessionPayload.session;
		pendingDocument = null;
		if (browser) {
			void goto(`/#${createSessionPayload.session._id}`, {
				replaceState: true,
				noScroll: true,
				keepFocus: true
			});
		}
		return session;
	}

	async function streamAnalysis(queries: string[]) {
		const activeSession = await ensureSavedSession();
		if (!activeSession) return;

		const response = await fetch('/api/analyze', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				sessionId: activeSession._id,
				query: queries.length === 1 ? queries[0] : undefined,
				queries: queries.length > 1 ? queries : undefined,
				noiseInjection
			})
		});
		if (!response.ok || !response.body) {
			const payload = (await response.json()) as { error?: string };
			throw new Error(payload.error ?? 'Analysis failed.');
		}

		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = '';

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			const { events, remainder } = parseSSEChunks(buffer);
			buffer = remainder;
			for (const eventBlock of events) {
				const line = eventBlock.split('\n').find((item) => item.startsWith('data: '));
				if (!line) continue;
				const payload = JSON.parse(line.slice(6)) as AnalysisStreamEvent;
				if (payload.type === 'status') {
					runStatusText = payload.message ?? runStatusText;
					const logPayload = {
						status: payload.status,
						model: payload.model,
						pipeline: payload.pipeline,
						query: payload.query,
						progress: payload.progress,
						message: payload.message
					};
					if (payload.status === 'failed' || payload.status === 'rate_limited') {
						console.warn('[ContextLens analyze]', logPayload);
					} else {
						console.log('[ContextLens analyze]', logPayload);
					}
				} else if (payload.run) {
					runs = [...runs, payload.run];
					console.log('[ContextLens run succeeded]', {
						model: payload.run.modelName,
						family: payload.run.modelFamily,
						provider: payload.run.provider,
						pipeline: payload.run.pipeline,
						query: payload.run.query,
						confidence: payload.run.confidence,
						latencyMs: payload.run.latencyMs,
						hallucinationCount: payload.run.hallucinationCount
					});
				} else if (payload.type === 'done') {
					runStatusText = payload.message ?? 'Analysis complete.';
					console.log('[ContextLens analyze done]', payload);
				} else if (payload.type === 'error') {
					runStatusText = payload.error ?? 'Analysis failed.';
					console.error('[ContextLens analyze error]', payload);
				}
			}
		}
	}

	async function runAnalysis() {
		const singleQuery = query.trim();
		if (!session || !singleQuery) return;
		isAnalyzing = true;
		activeTab = 'outputs';
		runs = runs.filter((run) => run.query !== singleQuery);
		runStatusText = `Starting single-query run: ${singleQuery.slice(0, 80)}`;
		try {
			await streamAnalysis([singleQuery]);
		} catch (error) {
			runStatusText = error instanceof Error ? error.message : 'Analysis failed.';
		} finally {
			isAnalyzing = false;
			await Promise.all([refreshSessions(), refreshAllRuns()]);
		}
	}

	async function generateQueries() {
		if (!session) return;
		isGeneratingQueries = true;
		try {
			const activeSession = await ensureSavedSession();
			if (!activeSession) return;
			statusText = 'Generating research queries...';
			const queries = await fetchGeneratedQueries(activeSession);
			generatedQueries = queries;
			query = queries[0] ?? '';
			activeTab = 'outputs';
			runStatusText = `Generated ${queries.length} research queries. Selected query 1 for Single. Use Batch tab to run the full queue.`;
		} catch (error) {
			statusText = error instanceof Error ? error.message : 'Query generation failed.';
		} finally {
			isGeneratingQueries = false;
			await Promise.all([refreshSessions(), refreshAllRuns()]);
		}
	}

	async function fetchGeneratedQueries(activeSession: SessionSummary) {
		const response = await fetch(`/api/sessions/${activeSession._id}/queries`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ count: 8 })
		});
		const payload = (await response.json()) as { queries?: string[]; error?: string };
		if (!response.ok || !payload.queries?.length) {
			throw new Error(payload.error ?? 'Failed to generate queries.');
		}
		return payload.queries;
	}

	async function runResearchBatch() {
		if (!session) return;
		const queries = batchQueries.slice(0, 10);
		if (queries.length === 0) return;
		isAnalyzing = true;
		activeTab = 'outputs';
		runs = runs.filter((run) => !queries.includes(run.query ?? ''));
		runStatusText = 'Starting research batch...';
		try {
			await streamAnalysis(queries);
		} catch (error) {
			runStatusText = error instanceof Error ? error.message : 'Research batch failed.';
		} finally {
			isAnalyzing = false;
			await Promise.all([refreshSessions(), refreshAllRuns()]);
		}
	}

	async function runGeneratedResearchBatch() {
		if (!session) return;
		isGeneratingQueries = true;
		isAnalyzing = true;
		activeTab = 'outputs';
		runStatusText = 'Generating and launching research batch...';
		try {
			const activeSession = await ensureSavedSession();
			if (!activeSession) return;
			const queries = (await fetchGeneratedQueries(activeSession)).slice(0, 10);
			generatedQueries = queries;
			query = queries[0] ?? '';
			runs = runs.filter((run) => !queries.includes(run.query ?? ''));
			isGeneratingQueries = false;
			await streamAnalysis(queries);
		} catch (error) {
			runStatusText = error instanceof Error ? error.message : 'Research batch failed.';
		} finally {
			isGeneratingQueries = false;
			isAnalyzing = false;
			await Promise.all([refreshSessions(), refreshAllRuns()]);
		}
	}

	function handleNewSession() {
		skipHashRestore = true;
		session = null;
		pendingDocument = null;
		query = '';
		generatedQueries = [];
		runStatusText = '';
		runs = [];
		statusText = 'Upload or paste a document to begin.';
		if (browser) {
			replaceState(window.location.pathname, window.history.state);
			void goto('/', { replaceState: true, noScroll: true, keepFocus: true }).finally(() => {
				skipHashRestore = false;
			});
		} else {
			skipHashRestore = false;
		}
	}

	function removeDocument() {
		handleNewSession();
	}

	function toggleNoise() {
		noiseInjection = !noiseInjection;
		statusText = noiseInjection
			? 'Noise injection enabled for next run.'
			: 'Noise injection disabled.';
		runStatusText = '';
	}

	async function restoreSession(item: { id: string; filename: string }) {
		skipHashRestore = false;
		pendingDocument = null;
		const [sessionResponse] = await Promise.all([
			fetch(`/api/sessions/${item.id}`),
			loadSessionRuns(item.id)
		]);
		if (sessionResponse.ok) {
			const payload = (await sessionResponse.json()) as { session: SessionSummary };
			session = payload.session;
			query = '';
			generatedQueries = [];
			if (browser) {
				void goto(`/#${item.id}`, { replaceState: true, noScroll: true, keepFocus: true });
			}
			statusText = `Restored session: ${payload.session.title || item.filename}`;
			runStatusText = '';
			activeTab = 'outputs';
		}
	}

	async function restoreSessionByHash(hashValue: string) {
		if (skipHashRestore) {
			return;
		}
		const id = hashValue.replace('#', '').trim();
		if (!id) {
			return;
		}
		if (session?._id === id) {
			return;
		}

		const [sessionResponse] = await Promise.all([
			fetch(`/api/sessions/${id}`),
			loadSessionRuns(id)
		]);
		if (!sessionResponse.ok) {
			return;
		}

		const payload = (await sessionResponse.json()) as { session: SessionSummary };
		pendingDocument = null;
		session = payload.session;
		query = '';
		generatedQueries = [];
		statusText = `Restored session: ${payload.session.title || payload.session.filename}`;
		runStatusText = '';
		activeTab = 'outputs';
	}

	$effect(() => {
		refreshSessions();
		refreshAllRuns();
	});

	$effect(() => {
		if (!browser) {
			return;
		}
		if (skipHashRestore) {
			return;
		}
		const hash = window.location.hash;
		if (!hash) {
			return;
		}
		restoreSessionByHash(hash);
	});
</script>

<div
	class="min-h-screen lg:h-screen overflow-x-hidden bg-background text-foreground font-mono dark"
>
	<div class="h-full flex flex-col">
		<Header onNewSession={handleNewSession} />

		<main class="flex-1 min-h-0 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden">
			<div
				class="w-full lg:w-2/5 min-h-0 border-b lg:border-b-0 lg:border-r border-border shrink-0"
			>
				<DocumentPanel
					bind:query
					{session}
					{statusText}
					{isUploading}
					{isAnalyzing}
					{isGeneratingQueries}
					{noiseInjection}
					onUpload={handleUpload}
					onPasteText={handlePasteText}
					onToggleNoise={toggleNoise}
					onRunQuery={runAnalysis}
					onGenerateQueries={generateQueries}
					onRunResearchBatch={runResearchBatch}
					onRemoveDocument={removeDocument}
				/>
			</div>

			<div class="w-full lg:w-3/5 flex-1 min-h-0 bg-muted/10">
				<Tabs
					value={activeTab}
					onValueChange={(v) => (activeTab = v as never)}
					class="min-h-0 flex flex-col lg:h-full"
				>
					<div class="border-b border-border bg-card shrink-0 p-2">
						<TabsList class="grid w-full grid-cols-4 bg-muted h-11">
							<TabsTrigger
								value="outputs"
								class="font-bold uppercase tracking-wide text-[10px] sm:text-xs flex gap-1 sm:gap-2 h-9 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
							>
								<ListTree class="w-3.5 h-3.5 sm:w-4 sm:h-4" /> Outputs
							</TabsTrigger>
							<TabsTrigger
								value="analytics"
								class="font-bold uppercase tracking-wide text-[10px] sm:text-xs flex gap-1 sm:gap-2 h-9 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
							>
								<LayoutGrid class="w-3.5 h-3.5 sm:w-4 sm:h-4" /> Analytics
							</TabsTrigger>
							<TabsTrigger
								value="benchmarking"
								class="font-bold uppercase tracking-wide text-[10px] sm:text-xs flex gap-1 sm:gap-2 h-9 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
							>
								<FlaskConical class="w-3.5 h-3.5 sm:w-4 sm:h-4" /> Batch
							</TabsTrigger>
							<TabsTrigger
								value="history"
								class="font-bold uppercase tracking-wide text-[10px] sm:text-xs flex gap-1 sm:gap-2 h-9 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
							>
								<Clock class="w-3.5 h-3.5 sm:w-4 sm:h-4" /> History
							</TabsTrigger>
						</TabsList>
					</div>

					<div class="flex-1 min-h-0 lg:relative lg:overflow-hidden">
						<TabsContent
							value="outputs"
							class="m-0 overflow-y-auto p-3 sm:p-6 space-y-4 sm:space-y-6 custom-scrollbar bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px] data-[state=inactive]:hidden lg:absolute lg:inset-0"
						>
							<div class="p-4 sm:p-6 border border-border bg-card rounded-lg shadow-sm">
								<div
									class="text-[10px] text-primary font-bold uppercase tracking-widest mb-2 flex items-center gap-2"
								>
									<span class="w-2 h-2 bg-primary rounded-full animate-pulse"></span>
									Active Query
								</div>
								<p class="text-base sm:text-xl font-bold">
									{query || 'Ask a question to start triple engine comparison.'}
								</p>
								{#if generatedQueries.length > 0}
									<div class="mt-3 text-[10px] uppercase tracking-widest text-muted-foreground">
										Generated queue: {generatedQueries.length} queries · Single runs only the selected
										query above.
									</div>
								{/if}
							</div>

							{#if runStatusText}
								<div
									class="border border-primary/30 bg-primary/10 p-3 text-primary text-[10px] font-bold uppercase tracking-widest"
								>
									{runStatusText}
								</div>
							{/if}

							<div class="grid grid-cols-1 xl:grid-cols-2 gap-3 sm:gap-6 mt-4 sm:mt-8">
								{#if currentQueryRuns.length === 0}
									<div
										class="col-span-full border border-border bg-card p-8 text-center text-sm uppercase tracking-widest text-muted-foreground font-bold"
									>
										{isAnalyzing
											? 'Waiting for model responses...'
											: 'No outputs yet. Upload a document and run a query.'}
									</div>
								{/if}
								{#each currentQueryRuns as run (`${run.modelName}-${run.pipeline}-${run.createdAt ?? 0}`)}
									<ModelResult {run} />
								{/each}
							</div>
						</TabsContent>

						<TabsContent
							value="analytics"
							class="m-0 data-[state=inactive]:hidden lg:absolute lg:inset-0"
						>
							<AnalyticsPanel {runs} {allRuns} />
						</TabsContent>

						<TabsContent
							value="benchmarking"
							class="m-0 overflow-y-auto p-3 sm:p-6 space-y-4 sm:space-y-6 data-[state=inactive]:hidden lg:absolute lg:inset-0"
						>
							<div class="border border-border bg-card p-4 sm:p-6 space-y-5">
								<div class="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
									<div>
										<h2
											class="text-2xl font-black uppercase tracking-tighter text-foreground flex items-center gap-3 mb-2"
										>
											<FlaskConical class="w-6 h-6 text-primary" /> Research Batch
										</h2>
										<p class="text-sm text-muted-foreground uppercase tracking-widest font-bold">
											Generate targeted probes, then run all pipelines across all models.
										</p>
									</div>
									<div class="grid grid-cols-1 xl:grid-cols-3 gap-2 w-full">
										<Button
											variant="outline"
											onclick={generateQueries}
											disabled={!session || isAnalyzing || isGeneratingQueries}
											class="uppercase font-bold text-xs tracking-widest min-h-10 h-auto whitespace-normal leading-tight"
										>
											{#if isGeneratingQueries}<Clock
													class="w-4 h-4 animate-spin"
												/>{:else}<WandSparkles class="w-4 h-4" />{/if}
											Generate
										</Button>
										<Button
											onclick={runGeneratedResearchBatch}
											disabled={!session || isAnalyzing || isGeneratingQueries}
											class="uppercase font-bold text-xs tracking-widest min-h-10 h-auto whitespace-normal leading-tight"
										>
											{#if isAnalyzing || isGeneratingQueries}<Clock
													class="w-4 h-4 animate-spin"
												/>{:else}<FlaskConical class="w-4 h-4" />{/if}
											Research Batch
										</Button>
										<Button
											variant="outline"
											onclick={runResearchBatch}
											disabled={!session || batchQueries.length === 0 || isAnalyzing}
											class="uppercase font-bold text-xs tracking-widest min-h-10 h-auto whitespace-normal leading-tight"
										>
											{#if isAnalyzing}<Clock class="w-4 h-4 animate-spin" />{:else}<Rows3
													class="w-4 h-4"
												/>{/if}
											Run Batch
										</Button>
									</div>
								</div>

								<div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
									<div class="border border-border bg-muted/20 p-3">
										<div class="text-[10px] uppercase tracking-widest text-muted-foreground">
											Queries
										</div>
										<div class="text-xl font-bold text-foreground">{batchQueries.length}</div>
									</div>
									<div class="border border-border bg-muted/20 p-3">
										<div class="text-[10px] uppercase tracking-widest text-muted-foreground">
											Current Batch Runs
										</div>
										<div class="text-xl font-bold text-foreground">{batchRunCount}</div>
									</div>
									<div class="border border-border bg-muted/20 p-3">
										<div class="text-[10px] uppercase tracking-widest text-muted-foreground">
											Mode Grid
										</div>
										<div class="text-xl font-bold text-foreground">3 pipelines</div>
									</div>
								</div>

								<div class="space-y-2">
									<div class="text-xs font-bold uppercase tracking-widest text-foreground">
										Generated Query Queue
									</div>
									{#if batchQueries.length === 0}
										<div
											class="border border-border bg-muted/20 p-4 text-xs uppercase tracking-widest text-muted-foreground"
										>
											No generated queries yet.
										</div>
									{:else}
										<div class="space-y-2">
											{#each batchQueries as item, index}
												<div class="border border-border bg-background p-3 text-sm">
													<span class="text-primary font-bold">{index + 1}.</span>
													{item}
												</div>
											{/each}
										</div>
									{/if}
								</div>
							</div>
						</TabsContent>

						<TabsContent
							value="history"
							class="m-0 overflow-y-auto p-3 sm:p-6 text-muted-foreground space-y-4 data-[state=inactive]:hidden lg:absolute lg:inset-0 lg:h-full"
						>
							{#if historyItems.length === 0}
								<div class="h-full flex flex-col items-center justify-center space-y-4">
									<Clock class="w-12 h-12 opacity-50" />
									<div class="text-sm font-bold uppercase tracking-widest">
										No Previous Sessions Found
									</div>
								</div>
							{:else}
								<div class="space-y-3">
									{#each historyItems as item}
										<button
											onclick={() => restoreSession(item)}
											class="w-full text-left border border-border bg-card p-3 sm:p-4 hover:border-primary transition-colors"
										>
											<div class="text-xs uppercase tracking-widest text-muted-foreground">
												{item.createdAt}
											</div>
											<div class="font-bold text-foreground mt-1 text-sm sm:text-base">
												{item.title}
											</div>
											<div class="text-[10px] uppercase tracking-widest mt-2 text-primary">
												Click to restore session
											</div>
										</button>
									{/each}
								</div>
							{/if}
						</TabsContent>
					</div>
				</Tabs>
			</div>
		</main>
	</div>
</div>

<style>
	:global(.custom-scrollbar::-webkit-scrollbar) {
		width: 8px;
	}
	:global(.custom-scrollbar::-webkit-scrollbar-track) {
		background: var(--background);
	}
	:global(.custom-scrollbar::-webkit-scrollbar-thumb) {
		background: var(--muted);
		border-radius: 4px;
	}
	:global(.custom-scrollbar::-webkit-scrollbar-thumb:hover) {
		background: var(--muted-foreground);
	}
</style>
