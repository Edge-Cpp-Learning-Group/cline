import { listFiles } from "../glob/list-files"

export async function isLargeCodebase(codebasePath: string): Promise<boolean> {
	const [filePaths, isTruncated] = await listFiles(codebasePath, false, 1000)
	return isChromium(filePaths)
}

export async function isEdgeCodebase(codebasePath: string): Promise<boolean> {
	const [filePaths, isTruncated] = await listFiles(codebasePath, false, 200)
	return isEdge(filePaths)
}

function isChromium(filePaths: string[]): boolean {
	return (
		filePaths.some((filePath) => filePath.includes("chrome")) &&
		filePaths.some((filePath) => filePath.includes("components")) &&
		filePaths.some((filePath) => filePath.includes("content")) &&
		filePaths.some((filePath) => filePath.includes("v8")) &&
		filePaths.some((filePath) => filePath.includes("extensions"))
	)
}

function isEdge(filePaths: string[]): boolean {
	return isChromium(filePaths) && filePaths.some((filePath) => filePath.includes("edge_"))
}
