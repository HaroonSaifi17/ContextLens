<script lang="ts">
	import Header from '$lib/components/Header.svelte';
	import DocumentPanel from '$lib/components/DocumentPanel.svelte';
	import ModelResult from '$lib/components/ModelResult.svelte';
	import AnalyticsPanel from '$lib/components/AnalyticsPanel.svelte';
	import { Tabs, TabsContent, TabsList, TabsTrigger } from '$lib/components/ui/tabs';
	import { ListTree, LayoutGrid, Clock } from 'lucide-svelte';
	import type { AnalysisStreamEvent, PipelineRun, SessionSummary } from '$lib/types';

	let query = $state('');
	let activeTab = $state<'outputs' | 'analytics' | 'history'>('outputs');
	let session = $state<SessionSummary | null>(null);
	let sessions = $state<SessionSummary[]>([]);
	let isUploading = $state(false);
	let isAnalyzing = $state(false);
	let noiseInjection = $state(false);
	let statusText = $state('Upload or paste a document to begin.');
	let runs = $state<PipelineRun[]>([]);
	let allRuns = $state<PipelineRun[]>([]);

	const historyItems = $derived(
		sessions.map((item) => ({
			id: item._id,
			filename: item.filename,
			createdAt: new Date(item.createdAt).toLocaleString()
		}))
	);

	const currentQueryRuns = $derived.by(() => {
		if (!query.trim()) return runs;
		const filtered = runs.filter((run) => run.query === query.trim());
		return filtered.length > 0 ? filtered : runs;
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
		statusText = 'Reading, chunking, and indexing document...';
		try {
			const formData = new FormData();
			formData.append('file', file);
			const response = await fetch('/api/upload', { method: 'POST', body: formData });
			const payload = (await response.json()) as { session?: SessionSummary; error?: string };
			if (!response.ok || !payload.session) throw new Error(payload.error ?? 'Upload failed.');
			session = payload.session;
			runs = [];
			statusText = 'Document ready. Ask a question to run triple engine across Groq models.';
			await Promise.all([refreshSessions(), refreshAllRuns()]);
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

	async function runAnalysis() {
		if (!session || !query.trim()) return;
		isAnalyzing = true;
		runs = [];
		statusText = 'Starting triple answer engine...';
		try {
			const response = await fetch('/api/analyze', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ sessionId: session._id, query: query.trim(), noiseInjection })
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
						statusText = payload.message ?? statusText;
					} else if (payload.run) {
						runs = [...runs, payload.run];
					} else if (payload.type === 'done') {
						statusText = payload.message ?? 'Analysis complete.';
					} else if (payload.type === 'error') {
						statusText = payload.error ?? 'Analysis failed.';
					}
				}
			}
		} catch (error) {
			statusText = error instanceof Error ? error.message : 'Analysis failed.';
		} finally {
			isAnalyzing = false;
			await Promise.all([refreshSessions(), refreshAllRuns()]);
		}
	}

	function handleNewSession() {
		session = null;
		query = '';
		runs = [];
		statusText = 'Upload or paste a document to begin.';
	}

	function removeDocument() {
		handleNewSession();
	}

	function toggleNoise() {
		noiseInjection = !noiseInjection;
		statusText = noiseInjection
			? 'Noise injection enabled for next run.'
			: 'Noise injection disabled.';
	}

	async function restoreSession(item: { id: string; filename: string }) {
		const [sessionResponse] = await Promise.all([
			fetch(`/api/sessions/${item.id}`),
			loadSessionRuns(item.id)
		]);
		if (sessionResponse.ok) {
			const payload = (await sessionResponse.json()) as { session: SessionSummary };
			session = payload.session;
			statusText = `Restored session: ${item.filename}`;
			activeTab = 'outputs';
		}
	}

	$effect(() => {
		refreshSessions();
		refreshAllRuns();
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
					{noiseInjection}
					onUpload={handleUpload}
					onPasteText={handlePasteText}
					onToggleNoise={toggleNoise}
					onRunQuery={runAnalysis}
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
						<TabsList class="grid w-full grid-cols-3 bg-muted h-11">
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
							</div>

							<div class="grid grid-cols-1 xl:grid-cols-2 gap-3 sm:gap-6 mt-4 sm:mt-8">
								{#if currentQueryRuns.length === 0}
									<div
										class="col-span-full border border-border bg-card p-8 text-center text-sm uppercase tracking-widest text-muted-foreground font-bold"
									>
										No outputs yet. Upload a document and run a query.
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
												{item.filename}
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
