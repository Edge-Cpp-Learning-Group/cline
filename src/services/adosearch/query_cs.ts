import { chromium } from "playwright" // 引入 Playwright

async function openPage(url: string, pageSize: number): Promise<string[]> {
	const browser = await chromium.launch() // 启动浏览器
	const page = await browser.newPage() // 创建新页面

	await page.goto(url, { waitUntil: "domcontentloaded" }) // 打开指定的页面并等待 DOM 加载完成

	// 在 localStorage 中添加项目
	await page.evaluate((size: number) => {
		localStorage.setItem("devops::__SourceSettings_PageSize", "" + size) // 添加项目
	}, pageSize) // 传递 pageSize

	// 等待 id="search-result-header-0" 的元素出现，最多等待 10 秒
	const elementFound = await new Promise<boolean>((resolve) => {
		let elapsedTime = 0
		const interval = setInterval(async () => {
			const element = await page.$("#search-result-header-0") // 查找元素
			if (element) {
				clearInterval(interval)
				resolve(true) // 找到元素
			}
			elapsedTime += 100
			if (elapsedTime >= 10000) {
				clearInterval(interval)
				resolve(false) // 超过 10 秒
			}
		}, 100)
	})

	await page.waitForTimeout(1000)
	// 截图
	await page.screenshot({ path: "screenshot.png" })

	// 提取所有 id 为 search-result-header-N 的 a 标签的链接
	const links = await page.evaluate(() => {
		const results: string[] = []
		let i = 1
		let element: HTMLAnchorElement | null

		while ((element = document.getElementById(`search-result-header-${i}`) as HTMLAnchorElement) !== null) {
			results.push(element.href)
			i++
		}

		return results
	})

	// 遍历所有链接并提取 ':' 到 '?' 之间的内容，忽略包含 "test" 的链接
	const extractedContents = links
		.filter((link: string) => !link.includes("test")) // 过滤掉包含 "test" 的链接
		.map((link: string) => {
			const startIndex = link.indexOf("main:") + 5 // 找到 ':' 的索引
			const endIndex = link.indexOf("?") // 找到 '?' 的索引
			return link.substring(startIndex, endIndex) // 提取内容
		})

	console.log("Extracted Contents:", extractedContents) // 打印提取的内容
	await browser.close()
	return extractedContents
}

export async function searchChromiumCodeBase(searchText: string, pageSize: number) {
	const url = `https://source.chromium.org/search?q=${encodeURIComponent(searchText)}&ss=chromium` // 构建 URL
	console.log(`Searching: ${searchText}, pageSize: ${pageSize}`) // 打印当前搜索的 URL
	return await openPage(url, pageSize)
}
