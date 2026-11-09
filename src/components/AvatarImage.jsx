import React from 'react';
import { getAvatarThumb, rememberAvatar } from '../utils/avatarCache';

// A profile photo that paints immediately: the saved copy sits underneath and the full photo
// covers it once loaded, so there's no empty circle in between. Fills its (rounded) parent.
const AvatarImage = React.memo(({ src, alt = '', draggable, imgStyle }) => {
  const thumb = getAvatarThumb(src);
  return (
    <span className="relative block w-full h-full">
      {thumb && (
        <img src={thumb} alt="" aria-hidden="true" decoding="sync" draggable={draggable} className="absolute inset-0 w-full h-full object-cover" style={imgStyle} />
      )}
      <img
        src={src}
        alt={alt}
        draggable={draggable}
        className="absolute inset-0 w-full h-full object-cover"
        style={imgStyle}
        onLoad={() => rememberAvatar(src)}
      />
    </span>
  );
});

export default AvatarImage;
