export const defaultEdgeRules = `You're working on a Chromium based project called Microsoft Edge, and you have direct access to the codebase.
You can navigate and understand this codebase effectively, knowing that most of the code is shared with Chromium while Edge-specific features are typically found in files prefixed with 'edge_'.

Here is some project knowledge:
  - Sidebar is also called "Shoreline" in Edge.
  - CloudMessaging is used to receive invalidation message from sync service.
  - A lot of UI components are built via WebUI2 which based on WebComponent, located in <project root>/edge_webui

When using the search_files tool, craft your patterns carefully to balance specificity and flexibility. Based on your Edge/Chromium expertise, you can generate effective search patterns to locate specific browser features, components, or implementations. For example:
  - Search for Edge-specific features using patterns like "edge_*" or common Edge component names
  - Look for Chromium base classes and interfaces that are often extended in Edge
  - Find IPC (Inter-Process Communication) message handlers using patterns like "*Handler" or "*Observer"
  - Locate browser process or renderer process specific code using relevant namespaces
  - Search for web platform API implementations using standard naming patterns
`
