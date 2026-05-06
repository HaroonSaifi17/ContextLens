# ContextLens 🔍

[![Version](https://img.shields.io/badge/version-0.0.1-blue.svg?style=for-the-badge)](https://github.com/yourusername/contextlens)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)

> Long-document intelligence platform for **live hallucination detection**, **triple-pipeline comparison**, and **reliability analytics**.

**Live Demo:** [context-limit.vercel.app](https://context-limit.vercel.app/)

ContextLens allows you to upload a document (or paste text), ask a question, and compare LLM answers in real-time across three distinct environments:
- **No context** (question-only)
- **Full context** (entire document)
- **RAG context** (retrieved chunks)

Each query run is stored and analyzed, providing sentence-level grounding, context usage tags, and aggregate research metrics to deeply understand AI reliability.

---

## 🛠 Tech Stack

[![SvelteKit](https://img.shields.io/badge/SvelteKit-FF3E00?style=for-the-badge&logo=Svelte&logoColor=white)](https://kit.svelte.dev/)
[![Bun](https://img.shields.io/badge/Bun-%23000000.svg?style=for-the-badge&logo=bun&logoColor=white)](https://bun.sh/)
[![Tailwind CSS](https://img.shields.io/badge/tailwindcss-%2338B2AC.svg?style=for-the-badge&logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)
[![Convex](https://img.shields.io/badge/Convex-EA4A26?style=for-the-badge&logo=convex&logoColor=white)](https://convex.dev/)
[![Groq](https://img.shields.io/badge/Groq-F55036?style=for-the-badge&logo=groq&logoColor=white)](https://groq.com/)

---

## ✨ Key Features

- **Document Analysis:** Upload PDF/TXT/MD files or paste text for quick testing with progress states.
- **Triple Answer Engine:** Compare answers in real-time (No Context vs. Full Context vs. RAG) streamed via SSE.
- **Hallucination Detection:** Sentence-level hallucination highlighting and grounding.
- **Reliability Dashboard:** Global metrics across all sessions and runs, including a positional bias heatmap (lost-in-the-middle signal).
- **Advanced Tools:** Noise injection lab for controlled robustness testing, and automatic batch research query generation.
- **Exportable Reports:** Export detailed reliability reports in PDF, JSON, or LaTeX formats.

---

## 🚀 Getting Started

### Prerequisites
- [Bun](https://bun.sh/) installed on your machine.
- A [Convex](https://convex.dev/) account and project.
- A [Groq](https://console.groq.com/) API key.

### Installation

1. Clone the repository and install dependencies:
   ```bash
   bun install
   ```

2. Set up your environment variables. Create a `.env.local` file in the root directory:
   ```env
   PUBLIC_CONVEX_URL=https://<your-deployment>.convex.cloud
   PUBLIC_CONVEX_SITE_URL=https://<your-deployment>.convex.site
   GROQ_API_KEY=<your_groq_api_key>
   ```

3. Start the Convex development server:
   ```bash
   bunx convex dev
   ```

4. In a separate terminal, run the application:
   ```bash
   bun run dev
   ```

---

## 🏗 Project Structure

- `src/routes/` - Main app shell, client orchestration, and API endpoints (`api/analyze`, `api/upload`, `api/runs`, `api/report`).
- `src/lib/components/` - Svelte components (Upload, Results, Analytics, etc.).
- `src/lib/server/` - Server-side logic for retrieval, chunking, and Groq LLM integration.
- `convex/` - Database schema and Convex backend functions.

## 📝 Usage Notes

- **Token Limits:** Context is automatically resized per model to reduce token-limit failures.
- **Rate Limiting:** Built-in rate limit handling with automatic retries and exponential backoff to safely navigate Groq free tier limits.
- **Model Deduplication:** Model families are deduplicated to prevent showing redundant variants.

## 📄 License

This project is licensed under the [MIT License](LICENSE).
