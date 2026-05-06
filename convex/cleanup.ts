import { mutation } from './_generated/server';

export const removeIncompleteData = mutation({
	args: {},
	handler: async (ctx) => {
		// 1. Get a batch of runs
		const runs = await ctx.db.query('runs').take(100);

		const validSessionIds = new Set<string>();
		let deletedRuns = 0;

		// Delete runs that are from older schema versions (missing trustEfficiency)
		for (const run of runs) {
			if (run.trustEfficiency === undefined) {
				await ctx.db.delete(run._id);
				deletedRuns++;
			} else {
				validSessionIds.add(run.sessionId);
			}
		}

		// 2. Get a batch of sessions
		const sessions = await ctx.db.query('sessions').take(100);
		let deletedSessions = 0;
		let deletedChunks = 0;

		for (const session of sessions) {
			// If a session has no valid runs associated with it anymore, delete it entirely to keep the DB clean
			// Wait, if we paginate we can't assume a session has no runs just based on this batch of runs.
			// Let's explicitly check if a session has any runs at all
			const sessionRuns = await ctx.db
				.query('runs')
				.withIndex('by_session', (q) => q.eq('sessionId', session._id))
				.first();

			if (!sessionRuns) {
				await ctx.db.delete(session._id);
				deletedSessions++;

				// 3. Delete chunks in batches
				let hasMore = true;
				while (hasMore) {
					const chunks = await ctx.db
						.query('chunks')
						.withIndex('by_session', (q) => q.eq('sessionId', session._id))
						.take(50);

					if (chunks.length === 0) {
						hasMore = false;
					} else {
						for (const chunk of chunks) {
							await ctx.db.delete(chunk._id);
							deletedChunks++;
						}
					}
				}
			}
		}

		return {
			message: 'Cleanup complete for batch',
			deletedRuns,
			deletedSessions,
			deletedChunks
		};
	}
});
