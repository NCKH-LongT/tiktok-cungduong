'use client';

import { useId, useState } from 'react';
import styles from './BuddhistUserBadge.module.css';

type Props = {
  username: string;
  avatarUrl?: string;
  elementRef?: (node: HTMLDivElement | null) => void;
};

export default function BuddhistUserBadge({ username, avatarUrl, elementRef }: Props) {
  const maskId = useId().replaceAll(':', '');
  const flowerId = maskId + 'flower';
  const [failedAvatar, setFailedAvatar] = useState('');
  const graphemes = Array.from(username).length;
  const size = graphemes > 30 ? 'small' : graphemes > 18 ? 'medium' : 'normal';
  const initials = Array.from(username.trim())[0] ?? '☸';

  return <div className={styles.badge} ref={elementRef} aria-label={`Phật tử ${username}`}>
    <div className={styles.avatar}>
      <span aria-hidden="true">{initials}</span>
      {avatarUrl && failedAvatar !== avatarUrl && <img src={avatarUrl} alt="" referrerPolicy="no-referrer" onError={() => setFailedAvatar(avatarUrl)} />}
    </div>
    <svg className={styles.background} viewBox="0 0 2170 725" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse">
          <rect width="2170" height="725" fill="white" />
          <circle cx="405" cy="335" r="194" fill="black" />
        </mask>
        <clipPath id={flowerId} clipPathUnits="userSpaceOnUse">
          <path d="M0 375 L125 405 L190 432 L250 415 L315 424 L365 454 L420 494 L490 528 L610 515 L700 475 L820 475 L900 725 L0 725 Z" />
        </clipPath>
      </defs>
      <image href="/overlay/bang-ten-phat-tu.png" width="2170" height="725" mask={`url(#${maskId})`} />
      <image href="/overlay/bang-ten-phat-tu.png" width="2170" height="725" clipPath={`url(#${flowerId})`} />
    </svg>
    <div className={`${styles.username} ${styles[size]}`}><span>{username}</span></div>
  </div>;
}
