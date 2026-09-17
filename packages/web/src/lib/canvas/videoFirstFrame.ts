/** Seek a muted preview video to the first decodable frame for card thumbnails. */
export function primeVideoFirstFrame(video: HTMLVideoElement): void {
  const seek = () => {
    if (!Number.isFinite(video.duration) || video.duration <= 0) {
      video.currentTime = 0;
      return;
    }
    video.currentTime = Math.min(0.08, Math.max(0, video.duration - 0.05));
  };

  if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
    seek();
  } else {
    video.addEventListener("loadedmetadata", seek, { once: true });
  }
}
