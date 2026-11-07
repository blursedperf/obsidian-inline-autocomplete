import BUNDLED_DICTIONARY_TEXT from "./dictionary.txt";

/**
 * Built-in high-frequency technical and academic vocabulary.
 */
export const TECHNICAL_VOCABULARY: string[] = [
	"abbreviations",
	"accessibility",
	"accomplishment",
	"accountability",
	"acknowledgement",
	"administration",
	"algorithm",
	"algorithms",
	"alternative",
	"alternatives",
	"analysis",
	"application",
	"applications",
	"approximately",
	"architecture",
	"argumentation",
	"authentication",
	"authorization",
	"automatically",
	"availability",
	"background",
	"bibliography",
	"brainstorming",
	"characteristic",
	"characteristics",
	"classification",
	"collaboration",
	"communication",
	"compatibility",
	"comprehensive",
	"conceptual",
	"conclusion",
	"conclusions",
	"configuration",
	"consequently",
	"consideration",
	"considerations",
	"consistency",
	"consolidation",
	"constitutional",
	"construction",
	"contemporary",
	"contextually",
	"contribution",
	"contributions",
	"controversial",
	"conversation",
	"conversations",
	"corresponding",
	"counterintuitive",
	"cryptography",
	"customization",
	"decentralized",
	"decomposition",
	"definition",
	"definitions",
	"demonstration",
	"dependencies",
	"dependency",
	"deployment",
	"description",
	"descriptions",
	"determination",
	"deterministic",
	"development",
	"differentiation",
	"distribution",
	"documentation",
	"effectiveness",
	"efficiency",
	"electrochemical",
	"encapsulation",
	"environment",
	"environmental",
	"epistemology",
	"establishment",
	"evaluation",
	"experimental",
	"experimentation",
	"explanation",
	"explanations",
	"extensibility",
	"extraordinary",
	"flashcards",
	"flexibility",
	"functionality",
	"fundamental",
	"fundamentals",
	"generalization",
	"hallucination",
	"hierarchical",
	"hyperparameter",
	"hypothesis",
	"identification",
	"illustration",
	"implementation",
	"implementations",
	"implications",
	"importantly",
	"improvement",
	"improvements",
	"independently",
	"individual",
	"information",
	"infrastructure",
	"initialization",
	"institutional",
	"instructions",
	"instrumentation",
	"integration",
	"intelligence",
	"interaction",
	"interactions",
	"interdisciplinary",
	"intermediate",
	"international",
	"interpretation",
	"introduction",
	"investigation",
	"justification",
	"knowledge",
	"localization",
	"maintainability",
	"maintenance",
	"management",
	"manifestation",
	"manufacturing",
	"mathematical",
	"measurement",
	"measurements",
	"methodology",
	"microarchitecture",
	"microservices",
	"miscellaneous",
	"modification",
	"modifications",
	"multiplication",
	"neuroscience",
	"nevertheless",
	"notification",
	"notifications",
	"observability",
	"observation",
	"observations",
	"operational",
	"opportunity",
	"optimization",
	"optimizations",
	"organization",
	"organizational",
	"orthogonality",
	"parallelism",
	"parameterization",
	"participation",
	"particularly",
	"performance",
	"perpendicular",
	"perspective",
	"perspectives",
	"philosophical",
	"photosynthesis",
	"polymorphism",
	"possibility",
	"possibilities",
	"practitioner",
	"preliminary",
	"preparation",
	"presentation",
	"prioritization",
	"probabilistic",
	"probability",
	"productivity",
	"professional",
	"programming",
	"psychological",
	"publication",
	"qualification",
	"quantitative",
	"questionnaire",
	"recommendation",
	"recommendations",
	"reconstruction",
	"refactoring",
	"reference",
	"references",
	"registration",
	"reinforcement",
	"relationship",
	"relationships",
	"reliability",
	"representation",
	"representations",
	"reproducibility",
	"requirements",
	"responsibility",
	"retrospective",
	"revolutionary",
	"scalability",
	"scheduling",
	"serialization",
	"significance",
	"significantly",
	"simultaneously",
	"specification",
	"specifications",
	"standardization",
	"statistical",
	"straightforward",
	"subsequently",
	"substantially",
	"supplementary",
	"sustainability",
	"synchronization",
	"systematically",
	"technological",
	"temperature",
	"terminology",
	"theoretical",
	"thermodynamics",
	"transformation",
	"transformations",
	"transmission",
	"transparency",
	"transportation",
	"troubleshooting",
	"understanding",
	"unfortunately",
	"universally",
	"utilization",
	"verification",
	"virtualization",
	"visualization",
	"vulnerability",
];

export const BUILTIN_DICTIONARY = TECHNICAL_VOCABULARY;

/**
 * Fast 2-character bucketed prefix index capable of searching 50,000–300,000+ words
 * in < 0.1 ms per keystroke with zero network calls and full local security.
 */
export class PrefixDictionaryIndex {
	private buckets: Map<string, string[]> = new Map();
	private wordCount = 0;
	private sourceLabel = "Bundled English dictionary";

	constructor() {
		this.loadBundledDictionary();
	}

	/**
	 * Load the fully bundled ~50,000-word English dictionary.
	 * Works 100% offline across desktop and mobile without network or external file dependencies.
	 */
	public loadBundledDictionary(): number {
		return this.loadFromRawText(
			BUNDLED_DICTIONARY_TEXT,
			"Bundled English dictionary (~50,000 words)",
			true
		);
	}

	/**
	 * Reset to only the compact high-frequency technical vocabulary.
	 */
	public resetToBuiltInDictionary(): void {
		this.loadWords(
			TECHNICAL_VOCABULARY,
			`Built-in technical vocabulary (${TECHNICAL_VOCABULARY.length} words)`
		);
	}

	/**
	 * Parse a raw wordlist or Hunspell .dic string and index all valid alphabetical words.
	 */
	public loadFromRawText(
		rawText: string,
		sourceLabel: string,
		includeBuiltIn = true
	): number {
		const lines = rawText.split(/\r?\n/);
		const words: string[] = includeBuiltIn ? [...TECHNICAL_VOCABULARY] : [];

		for (let i = 0; i < lines.length; i++) {
			let line = lines[i].trim();
			if (!line || line.startsWith("#")) continue;

			// Support Hunspell .dic format where entries look like "word/FLAGS"
			const slashIdx = line.indexOf("/");
			if (slashIdx > 0) {
				line = line.slice(0, slashIdx);
			}

			// Keep pure alphabetical words of length >= 4 (filters out numbers/password strings)
			if (line.length >= 4 && line.length <= 32 && /^[A-Za-z]+$/.test(line)) {
				words.push(line.toLowerCase());
			}
		}

		this.loadWords(words, sourceLabel);
		return this.wordCount;
	}

	/**
	 * Clear all index buckets to free memory when unloaded.
	 */
	public clear(): void {
		this.buckets.clear();
		this.wordCount = 0;
		this.sourceLabel = "Unloaded";
	}

	/**
	 * Index an array of words into 2-letter prefix buckets sorted by length then alphabetically.
	 */
	public loadWords(words: string[], sourceLabel: string): void {
		this.buckets.clear();
		const unique = new Set<string>();

		for (const w of words) {
			const lower = w.trim().toLowerCase();
			if (lower.length >= 4) {
				unique.add(lower);
			}
		}

		for (const word of unique) {
			const key = word.slice(0, 2);
			let bucket = this.buckets.get(key);
			if (!bucket) {
				bucket = [];
				this.buckets.set(key, bucket);
			}
			bucket.push(word);
		}

		// Sort each bucket so shorter, more common root words appear first
		for (const bucket of this.buckets.values()) {
			bucket.sort((a, b) => a.length - b.length || a.localeCompare(b));
		}

		this.wordCount = unique.size;
		this.sourceLabel = sourceLabel;
	}

	/**
	 * Query up to `limit` words starting with `lowerPrefix`.
	 */
	public findPrefixMatches(lowerPrefix: string, limit = 15): string[] {
		if (lowerPrefix.length < 2) {
			return [];
		}
		const key = lowerPrefix.slice(0, 2);
		const bucket = this.buckets.get(key);
		if (!bucket) {
			return [];
		}

		const results: string[] = [];
		for (let i = 0; i < bucket.length; i++) {
			const word = bucket[i];
			if (word.length > lowerPrefix.length && word.startsWith(lowerPrefix)) {
				results.push(word);
				if (results.length >= limit) {
					break;
				}
			}
		}
		return results;
	}

	public getWordCount(): number {
		return this.wordCount;
	}

	public getSourceLabel(): string {
		return this.sourceLabel;
	}
}
