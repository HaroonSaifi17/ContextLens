import { ConvexHttpClient } from 'convex/browser';
import { makeFunctionReference } from 'convex/server';
import { env as publicEnv } from '$env/dynamic/public';

export function convexClient() {
	const url = publicEnv.PUBLIC_CONVEX_URL;
	if (!url) {
		throw new Error('PUBLIC_CONVEX_URL is not configured.');
	}

	return new ConvexHttpClient(url);
}

export const convexFunctions = {
	createSession: makeFunctionReference<'mutation'>('documents:createSession'),
	getSession: makeFunctionReference<'query'>('documents:getSession'),
	getChunks: makeFunctionReference<'query'>('documents:getChunks'),
	listSessions: makeFunctionReference<'query'>('documents:listSessions'),
	getAllRuns: makeFunctionReference<'query'>('documents:getAllRuns'),
	getRuns: makeFunctionReference<'query'>('documents:getRuns'),
	createRun: makeFunctionReference<'mutation'>('runs:createRun')
} as const;
