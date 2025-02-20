import axios from "axios"
import * as fs from "fs"
import * as path from "path"
import { ClineIgnoreController } from "../../core/ignore/ClineIgnoreController"

interface SearchResult {
	count: number
	results: Array<{
		fileName: string
		path: string
		repository: {
			name: string
			id: string
		}
		project: {
			name: string
			id: string
		}
		versions: Array<{
			branchName: string
		}>
		matches: {
			content: Array<{
				type: string
				charOffset: number
				length: number
				codeSnippet: string | null
			}>
		}
	}>
}

interface SearchFilters {
	Project: string[]
	Repository: string[]
	Branch: string[]
	Path: string[]
}

interface SearchRequest {
	searchText: string
	$top: number
	$skip: number
	includeSnippet: boolean
	includeFacets: boolean
	previewLines: number
	hitHighlighting: boolean
	scoreOption: string
	filters: SearchFilters
}

interface localSearchResult {
	fileName: string
	path: string
	content: string
}

export class AzureDevOpsCodeSearch {
	private organization: string
	private personalAccessToken: string
	private baseUrl: string
	private apiVersion: string
	private headers: Record<string, string>
	private localBasePath: string
	private lastSearchText: string
	private filePattern: string | null

	constructor(organization: string, personalAccessToken: string, localBasePath: string = "D:\\Edge\\src") {
		this.organization = organization
		this.personalAccessToken = personalAccessToken
		this.baseUrl = `https://almsearch.dev.azure.com/${organization}/_apis/search/codesearchresults`
		this.apiVersion = "7.2-preview.1"
		this.localBasePath = localBasePath
		this.lastSearchText = ""
		this.filePattern = null

		const auth = Buffer.from(`:${personalAccessToken}`).toString("base64")
		this.headers = {
			Authorization: `Basic ${auth}`,
			"Content-Type": "application/json",
		}
	}

	async searchCode(
		searchText: string,
		project: string,
		repository: string,
		path: string | null = null,
		filePattern: string | null = null,
		top: number = 100,
	): Promise<SearchResult> {
		this.lastSearchText = searchText
		this.filePattern = filePattern

		searchText = `${searchText} NOT file:*test*`
		if (filePattern) {
			searchText = `${searchText} AND file:${filePattern}`
		}

		const searchRequest: SearchRequest = {
			searchText,
			$top: top,
			$skip: 0,
			includeSnippet: true,
			includeFacets: true,
			previewLines: 3,
			hitHighlighting: true,
			scoreOption: "Default",
			filters: {
				Project: [project],
				Repository: [repository],
				Branch: ["main"],
				Path: path ? [path] : ["/"],
			},
		}

		try {
			const response = await axios.post(this.baseUrl, searchRequest, {
				headers: this.headers,
				params: {
					"api-version": this.apiVersion,
				},
			})
			return response.data
		} catch (error) {
			if (axios.isAxiosError(error)) {
				throw new Error(`搜索失败: ${error.response?.status} - ${error.response?.data || error.message}`)
			}
			throw error
		}
	}

	private getLocalFileContent(filePath: string): string | null {
		const fullPath = path.join(this.localBasePath, filePath.replace(/^\//, ""))
		try {
			//const fullPath = path.join(this.localBasePath, filePath.replace(/^\//, ''));
			return fs.readFileSync(fullPath, "utf8")
		} catch (error) {
			console.error(`无法读取本地文件 ${fullPath}: ${(error as Error).message}`)
			return null
		}
	}

	private extractCodeSnippet(content: string, searchText: string, contextLines: number = 2): string | null {
		const lines = content.split("\n")
		const results: string[] = []
		const processedRanges = new Set<string>()
		let lastEndLine = -1 // 记录上一个片段的结束行

		for (let i = 0; i < lines.length; i++) {
			if (lines[i].includes(searchText)) {
				const startLine = Math.max(0, i - contextLines)
				const endLine = Math.min(lines.length, i + contextLines + 1)

				let isOverlapping = false
				for (const range of processedRanges) {
					const [prevStart, prevEnd] = range.split("-").map(Number)
					if (startLine <= prevEnd && endLine >= prevStart) {
						isOverlapping = true
						break
					}
				}

				if (!isOverlapping) {
					// 如果与上一个片段不连续，添加分隔线
					if (lastEndLine !== -1 && startLine > lastEndLine) {
						results.push("------")
					}

					const snippet: string[] = []
					for (let j = startLine; j < endLine; j++) {
						let prefix = j === i ? "> " : "  "
						if (contextLines == 0) {
							prefix = ""
						}

						snippet.push(`${prefix}${j + 1}: ${lines[j]}`)
					}

					results.push(snippet.join("\n"))
					processedRanges.add(`${startLine}-${endLine}`)
					lastEndLine = endLine
				}
			}
		}

		return results.length > 0 ? results.join("\n") : null
	}

	localMatch(results: SearchResult): string[] {
		let lines: string[] = []
		if (!results.results) {
			return lines
		}

		for (const result of results.results) {
			lines.push(`${result.path}`.slice(1))

			const localContent = this.getLocalFileContent(result.path)

			if (localContent) {
				const snippet = this.extractCodeSnippet(localContent, this.lastSearchText, 2)
				if (snippet) {
					lines.push(snippet)
					lines.push("\n")
				}
			}
		}
		return lines
	}
}

function limitResults(lines: string[]): string {
	const MAX_RESULTS = 300

	let output = ""
	if (lines.length >= MAX_RESULTS) {
		output += `Showing first ${MAX_RESULTS} of ${MAX_RESULTS}+ results. Use a more specific search if necessary.\n\n`
	} else {
		output += `Found ${lines.length === 1 ? "1 result" : `${lines.length.toLocaleString()} results`}.\n\n`
	}

	// limit lines to MAX_RESULTS
	lines = lines.slice(0, MAX_RESULTS)

	return output + lines.join("\n")
}

export async function searchFilesWithADO(
	cwd: string,
	directoryPath: string,
	searchText: string,
	filePattern?: string,
	clineIgnoreController?: ClineIgnoreController,
): Promise<string> {
	const organization = "microsoft"
	const personalAccessToken = ""
	const localBasePath = "d:\\Edge\\src"

	const searcher = new AzureDevOpsCodeSearch(organization, personalAccessToken, localBasePath)
	const searchPath = directoryPath.replace(localBasePath, "")

	try {
		const results = await searcher.searchCode(searchText, "Edge", "chromium.src", searchPath, filePattern, 1000)
		const lines = searcher.localMatch(results)
		return limitResults(lines)
	} catch (error) {
		return "No results found"
	}
}
