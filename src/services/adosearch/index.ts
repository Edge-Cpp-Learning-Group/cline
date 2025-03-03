import axios from "axios"
import * as fs from "fs"
import * as path from "path"
import { ClineIgnoreController } from "../../core/ignore/ClineIgnoreController"
import simpleGit, { SimpleGit } from "simple-git"
import { searchChromiumCodeBase } from "./query_cs"

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

interface RepoInfo {
	organization: string
	project: string
	repository: string
	branch: string
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

	constructor(organization: string, personalAccessToken: string, localBasePath: string) {
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
		branch: string,
		path: string | null = null,
		filePattern: string | null = null,
		top: number = 100,
	): Promise<SearchResult> {
		this.lastSearchText = searchText
		this.filePattern = filePattern

		// xx|yy => (xx OR yy)
		// xx.*yy => (xx*yy OR xx yy)
		// xx.*yy|zz => ((xx*yy OR xx yy) OR zz)
		searchText = `(${searchText
			.split("|")
			.map((pattern) => {
				const patterns = pattern.split(".*")
				if (patterns.length === 1) {
					return patterns[0].trim()
				}
				return `(${patterns.join("*")} OR ${patterns.join(" ")})`
			})
			.join(" OR ")})`

		if (filePattern) {
			// filepattern:
			//   *.h,*.cc => (file:*.h OR file:*.cc)
			//   path1*/path2*/*.h,path3/path4*/*.cc => ((path:path1*/path2* AND file:*.h) OR (path:path3/path4* AND file:*.cc))
			const filePatterns = filePattern
				.split(",")
				.map((pattern) => {
					const parts = pattern.split("/")
					if (parts.length === 1) {
						return `file:${parts[0].trim()}`
					}
					const filePattern = parts.pop()
					return `(path:${parts.join("/")} AND file:${filePattern?.trim()})`
				})
				.join(" OR ")

			searchText = `${searchText} AND (${filePatterns})`
		} else {
			// exclude certain file types
			const excludedFileTypes = ["spec", "css", "md", "json", "xtb", "csv", "xml", "xmb", "resx"]
			searchText = `${searchText} NOT (${excludedFileTypes.map((type) => `file:*.${type}`).join(" OR ")})`
		}
		searchText += ` NOT file:*test*`

		let searchBranch
		if (branch && branch !== "main") {
			searchBranch = [branch, "main"]
		} else {
			searchBranch = ["main"]
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
				Branch: searchBranch,
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
			if (response.status !== 200) {
				throw new Error(`Search failed: ${response.status} - ${response.statusText}, please ensure your PAT is valid.`)
			}
			return response.data
		} catch (error) {
			if (axios.isAxiosError(error)) {
				if (error.response?.status === 401) {
					throw new Error("Search failed: 401 - Unauthorized, please ensure your PAT is valid.")
				}
				throw new Error(`Search failed: ${error.response?.status} - ${error.response?.data || error.message}`)
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
			console.error(`Unable to read local file ${fullPath}: ${(error as Error).message}`)
			return null
		}
	}

	private extractCodeSnippet(content: string, searchText: string, contextLines: number = 2): string | null {
		const lines = content.split("\n")
		const results: string[] = []
		const processedRanges = new Set<string>()
		const maxLineLength = 256
		const maxContextLines = 200
		let lastEndLine = -1

		const searchRegex = new RegExp(searchText.replace(/\*/g, ".*").replace(/\s+/g, ".*").replace(" ", ""), "i")

		for (let i = 0; i < lines.length; i++) {
			if (searchRegex.test(lines[i])) {
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
					if (lastEndLine !== -1 && startLine > lastEndLine) {
						results.push("------")
					}

					const snippet: string[] = []
					for (let j = startLine; j < endLine; j++) {
						let prefix = j === i ? "> " : "  "
						if (contextLines === 0) {
							prefix = ""
						}

						snippet.push(
							`${prefix}${j + 1}: ${lines[j].length > maxLineLength ? lines[j].slice(0, maxLineLength) + "..." : lines[j]}`,
						)
					}

					results.push(snippet.join("\n"))
					processedRanges.add(`${startLine}-${endLine}`)
					lastEndLine = endLine
				}
			}

			if (results.length >= maxContextLines) {
				results.push("------")
				results.push(`... and ${(lines.length - i) * 3} more lines`)
				break
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
			const localContent = this.getLocalFileContent(result.path)
			if (localContent) {
				const snippet = this.extractCodeSnippet(localContent, this.lastSearchText, 2)
				if (snippet) {
					lines.push(`${result.path}`.slice(1))
					lines.push(snippet)
					lines.push("\n")
				}
			}
		}
		return lines
	}

	localMatchAll(adoResults: SearchResult, csResultFileList: string[]): string[] {
		let fileList: string[] = []
		if (adoResults.results) {
			for (const result of adoResults.results) {
				fileList.push(result.path.slice(1))
			}
		}
		if (csResultFileList) {
			for (const result of csResultFileList) {
				fileList.push(result)
			}
		}
		// dedupe fileList
		fileList = [...new Set(fileList)]

		let lines: string[] = []
		if (!fileList) {
			return lines
		}

		for (const file of fileList) {
			const localContent = this.getLocalFileContent(file)
			if (localContent) {
				const snippet = this.extractCodeSnippet(localContent, this.lastSearchText, 2)
				if (snippet) {
					lines.push(`${file}`)
					lines.push(snippet)
					lines.push("\n")
				}
			}
		}

		return lines
	}
}

function limitResults(lines: string[]): string {
	const MAX_RESULTS = 50

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
	repoInfo?: RepoInfo,
	adoPat?: string,
): Promise<string> {
	const organization = repoInfo?.organization || ""
	const project = repoInfo?.project || ""
	const repository = repoInfo?.repository || ""
	const branch = repoInfo?.branch || ""
	const personalAccessToken = adoPat || ""
	const localBasePath = cwd

	if (!personalAccessToken) {
		throw new Error("Error: Azure DevOps Personal Access Token (PAT) is not set. Please configure it in settings.")
	}

	const searcher = new AzureDevOpsCodeSearch(organization, personalAccessToken, localBasePath)
	const searchPath = directoryPath.replace(localBasePath, "")

	try {
		const results = await searcher.searchCode(searchText, project, repository, branch, searchPath, filePattern, 1000)
		const lines = searcher.localMatch(results)
		// const fileList = await searchChromiumCodeBase(searchText, 25)
		// const lines = searcher.localMatchAll(results, fileList)
		return limitResults(lines)
	} catch (error) {
		return "No results found"
	}
}

export async function getRepoInfo(baseDir: string): Promise<RepoInfo | undefined> {
	try {
		const git: SimpleGit = simpleGit(baseDir)

		// Get remote repository URL
		const remotes = await git.getConfig("remote.origin.url")
		const remoteUrl = remotes.value || ""

		let organization = ""
		let project = ""
		let repository = ""

		// Parse URL
		if (remoteUrl.includes("dev.azure.com")) {
			// Format: https://organization@dev.azure.com/organization/project/_git/repo
			const matches = remoteUrl.match(/dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/]+)/)
			if (matches) {
				;[, organization, project, repository] = matches
			}
		} else if (remoteUrl.includes("visualstudio.com")) {
			// Format: https://organization.visualstudio.com/project/_git/repo
			const matches = remoteUrl.match(/([^.\/]+)\.visualstudio\.com\/DefaultCollection\/([^/]+)\/_git\/([^/]+)/)
			if (matches) {
				;[, organization, project, repository] = matches
			}
		} else {
			return undefined
		}

		// Get remote branch corresponding to current branch
		let branch = "main"
		try {
			const currentBranch = await git.revparse(["--abbrev-ref", "HEAD"])
			const remoteBranch = await git.revparse(["--abbrev-ref", `${currentBranch.trim()}@{upstream}`])
			if (remoteBranch) {
				// Extract branch name from origin/branch format
				branch = remoteBranch.split("/")[1]
			}
		} catch (error) {
			console.log('Unable to get remote branch information, using default branch "main"')
		}

		if (!organization || !project || !repository) {
			throw new Error("Unable to parse repository information from git remote URL")
		}

		return {
			organization,
			project,
			repository,
			branch,
		}
	} catch (error) {
		console.error("Failed to get repository information:", error)
		return undefined
	}
}
