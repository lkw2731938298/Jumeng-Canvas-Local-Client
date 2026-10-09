import { toast } from "sonner";

export interface MediaUploadToastResult {
	uploadedCount: number;
	assetNames?: string[];
}

function getAssetLabel({ count }: { count: number }): string {
	return count === 1 ? "个素材" : "个素材";
}

function waitForNextPaint(): Promise<void> {
	return new Promise((resolve) => {
		requestAnimationFrame(() => {
			requestAnimationFrame(() => resolve());
		});
	});
}

export async function showMediaUploadToast<T extends MediaUploadToastResult>({
	filesCount,
	promise,
}: {
	filesCount: number;
	promise: Promise<T> | (() => Promise<T>);
}) {
	const run = typeof promise === "function" ? promise : () => promise;
	const toastPromise = toast.promise(async () => {
		await waitForNextPaint();
		return run();
	}, {
		loading: `正在上传 ${filesCount} ${getAssetLabel({ count: filesCount })}…`,
		success: ({ uploadedCount, assetNames }) => {
			if (uploadedCount === 1) {
				const assetName = assetNames?.[0];
				return assetName ? `已上传：${assetName}` : "已上传 1 个素材";
			}

			if (uploadedCount > 1) {
				return `已上传 ${uploadedCount} 个素材`;
			}

			return "没有上传任何素材";
		},
		error: `上传素材失败`,
	});

	return toastPromise.unwrap();
}
