/**
 * badge_images.ts
 * Static PNG imports so esbuild can bundle the badge assets.
 * (import.meta.glob is Vite-only; this project uses esbuild.)
 */

import badge1  from '../assets/badges/badge_1.png';
import badge2  from '../assets/badges/badge_2.png';
import badge3  from '../assets/badges/badge_3.png';
import badge4  from '../assets/badges/badge_4.png';
import badge5  from '../assets/badges/badge_5.png';
import badge6  from '../assets/badges/badge_6.png';
import badge7  from '../assets/badges/badge_7.png';
import badge8  from '../assets/badges/badge_8.png';
import badge9  from '../assets/badges/badge_9.png';
// badge_10 image is absent from the asset set
import badge11 from '../assets/badges/badge_11.png';
import badge12 from '../assets/badges/badge_12.png';
import badge13 from '../assets/badges/badge_13.png';
import badge14 from '../assets/badges/badge_14.png';
import badge15 from '../assets/badges/badge_15.png';
import badge16 from '../assets/badges/badge_16.png';
import badge17 from '../assets/badges/badge_17.png';
import badge18 from '../assets/badges/badge_18.png';
import badge19 from '../assets/badges/badge_19.png';
import badge20 from '../assets/badges/badge_20.png';

export const BADGE_IMAGE_MAP: Record<string, string> = {
  badge_1:  badge1,
  badge_2:  badge2,
  badge_3:  badge3,
  badge_4:  badge4,
  badge_5:  badge5,
  badge_6:  badge6,
  badge_7:  badge7,
  badge_8:  badge8,
  badge_9:  badge9,
  badge_11: badge11,
  badge_12: badge12,
  badge_13: badge13,
  badge_14: badge14,
  badge_15: badge15,
  badge_16: badge16,
  badge_17: badge17,
  badge_18: badge18,
  badge_19: badge19,
  badge_20: badge20,
};
