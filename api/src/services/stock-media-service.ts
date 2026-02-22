import type {
  BackgroundType,
  StockMediaResult,
} from "../types/video";
import { BACKGROUND_SEARCH_QUERIES } from "../types/video";

const PEXELS_API_KEY = process.env.PEXELS_API_KEY;
const PEXELS_BASE_URL = "https://api.pexels.com";

interface PexelsVideo {
  id: number;
  url: string;
  video_files: Array<{
    id: number;
    quality: string;
    file_type: string;
    width: number;
    height: number;
    link: string;
  }>;
}

interface PexelsPhoto {
  id: number;
  url: string;
  src: {
    original: string;
    large2x: string;
    large: string;
    medium: string;
  };
  photographer: string;
}

interface PexelsVideoResponse {
  videos: PexelsVideo[];
  total_results: number;
}

interface PexelsPhotoResponse {
  photos: PexelsPhoto[];
  total_results: number;
}

/**
 * Fetches a stock video from Pexels based on background type
 */
export async function fetchStockVideo(
  backgroundType: BackgroundType
): Promise<StockMediaResult | null> {
  if (!PEXELS_API_KEY) {
    console.warn("PEXELS_API_KEY not set, falling back to gradient");
    return null;
  }

  const query = BACKGROUND_SEARCH_QUERIES[backgroundType];

  try {
    const response = await fetch(
      `${PEXELS_BASE_URL}/videos/search?query=${encodeURIComponent(query)}&orientation=portrait&size=medium&per_page=15`,
      {
        headers: {
          Authorization: PEXELS_API_KEY,
        },
      }
    );

    if (!response.ok) {
      console.error("Pexels API error:", response.status);
      return null;
    }

    const data: PexelsVideoResponse = await response.json();

    if (data.videos.length === 0) {
      return null;
    }

    // Pick a random video from results
    const video = data.videos[Math.floor(Math.random() * data.videos.length)];

    // Prefer 720p vertical to reduce download size and Lambda disk usage
    const TARGET_HEIGHT = 720;
    const vertical = video.video_files.filter((f) => f.height > f.width);
    const withinTarget = vertical.filter((f) => f.height <= TARGET_HEIGHT);
    const candidates = withinTarget.length > 0 ? withinTarget : vertical;
    const videoFile =
      candidates.sort((a, b) => b.height - a.height)[0] ||
      video.video_files[0];

    return {
      url: videoFile.link,
      type: "video",
      attribution: `Video from Pexels: ${video.url}`,
    };
  } catch (error) {
    console.error("Error fetching stock video:", error);
    return null;
  }
}

/**
 * Fetches a stock image from Pexels based on background type
 */
export async function fetchStockImage(
  backgroundType: BackgroundType
): Promise<StockMediaResult | null> {
  if (!PEXELS_API_KEY) {
    console.warn("PEXELS_API_KEY not set, falling back to gradient");
    return null;
  }

  const query = BACKGROUND_SEARCH_QUERIES[backgroundType];

  try {
    const response = await fetch(
      `${PEXELS_BASE_URL}/v1/search?query=${encodeURIComponent(query)}&orientation=portrait&size=large&per_page=15`,
      {
        headers: {
          Authorization: PEXELS_API_KEY,
        },
      }
    );

    if (!response.ok) {
      console.error("Pexels API error:", response.status);
      return null;
    }

    const data: PexelsPhotoResponse = await response.json();

    if (data.photos.length === 0) {
      return null;
    }

    // Pick a random photo from results
    const photo = data.photos[Math.floor(Math.random() * data.photos.length)];

    return {
      url: photo.src.large2x,
      type: "image",
      attribution: `Photo by ${photo.photographer} on Pexels: ${photo.url}`,
    };
  } catch (error) {
    console.error("Error fetching stock image:", error);
    return null;
  }
}

/**
 * Fetches stock media (prefers video, falls back to image)
 */
export async function fetchStockMedia(
  backgroundType: BackgroundType
): Promise<StockMediaResult | null> {
  // Try video first
  const video = await fetchStockVideo(backgroundType);
  if (video) return video;

  // Fall back to image
  const image = await fetchStockImage(backgroundType);
  if (image) return image;

  // No media found
  return null;
}
