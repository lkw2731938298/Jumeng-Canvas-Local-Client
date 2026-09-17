/**
 * 组库拖拽：从左侧「组」面板拖到画布。
 */
export const CANVAS_GROUP_MIME = "application/canvas-node-group";

export interface GroupDragPayload {
  groupId: string;
  projectId: string;
  title?: string;
}

export function setGroupDragData(dt: DataTransfer, payload: GroupDragPayload): void {
  dt.setData(CANVAS_GROUP_MIME, JSON.stringify(payload));
  dt.effectAllowed = "copy";
}

export function parseGroupDragPayload(raw: string): GroupDragPayload | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as GroupDragPayload;
    if (!data?.groupId || !data?.projectId) return null;
    return {
      groupId: String(data.groupId),
      projectId: String(data.projectId),
      title: data.title,
    };
  } catch {
    return null;
  }
}
