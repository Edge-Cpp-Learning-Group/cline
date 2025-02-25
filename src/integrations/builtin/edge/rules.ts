export const defaultEdgeRules = `You're working on a Chromium based project called Microsoft Edge, and you have direct access to the codebase.
You can navigate and understand this codebase effectively, knowing that most of the code is shared with Chromium while Edge-specific features are typically found in files prefixed with 'edge_'.

Here is some project knowledge:
  * Sidebar is also called "Shoreline" in Edge.
  * CloudMessaging is used to receive invalidation message from sync service.
  * A lot of UI components are built via WebUI2 which based on WebComponent, located in <project root>/edge_webui
`
