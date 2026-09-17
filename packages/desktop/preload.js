/**
 * 预加载：向渲染进程暴露本机文件 API（不暴露 Node 全集）。
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("jumengDesktop", {
  getDataRoot: () => ipcRenderer.invoke("desktop:getDataRoot"),
  readConfig: () => ipcRenderer.invoke("desktop:readConfig"),
  writeConfig: (cfg) => ipcRenderer.invoke("desktop:writeConfig", cfg),
  listProviders: () => ipcRenderer.invoke("desktop:listProviders"),
  saveProviders: (items) => ipcRenderer.invoke("desktop:saveProviders", items),
  listModels: () => ipcRenderer.invoke("desktop:listModels"),
  saveModels: (items) => ipcRenderer.invoke("desktop:saveModels", items),
  listProjects: () => ipcRenderer.invoke("desktop:listProjects"),
  createProject: (title) => ipcRenderer.invoke("desktop:createProject", title),
  getProject: (id) => ipcRenderer.invoke("desktop:getProject", id),
  updateProject: (id, patch) => ipcRenderer.invoke("desktop:updateProject", id, patch),
  deleteProject: (id) => ipcRenderer.invoke("desktop:deleteProject", id),
  readWorkflow: (projectId) => ipcRenderer.invoke("desktop:readWorkflow", projectId),
  writeWorkflow: (projectId, flow) =>
    ipcRenderer.invoke("desktop:writeWorkflow", projectId, flow),
  writeAsset: (projectId, fileName, base64) =>
    ipcRenderer.invoke("desktop:writeAsset", projectId, fileName, base64),
  readAssetAsDataUrl: (projectId, fileName) =>
    ipcRenderer.invoke("desktop:readAssetAsDataUrl", projectId, fileName),
  listAssets: (projectId) => ipcRenderer.invoke("desktop:listAssets", projectId),
  registerAssetMeta: (projectId, meta) =>
    ipcRenderer.invoke("desktop:registerAssetMeta", projectId, meta),
  deleteAsset: (projectId, assetId) =>
    ipcRenderer.invoke("desktop:deleteAsset", projectId, assetId),
  readNodeText: (projectId, nodeId) =>
    ipcRenderer.invoke("desktop:readNodeText", projectId, nodeId),
  writeNodeText: (projectId, nodeId, content, model) =>
    ipcRenderer.invoke("desktop:writeNodeText", projectId, nodeId, content, model),
});
