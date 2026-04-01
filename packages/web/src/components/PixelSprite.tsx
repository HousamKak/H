import { useMemo } from 'react';
import { getSpriteCSS, getSpriteDimensions } from '../sprites.js';

interface Props {
  role: string;
  size?: number;
}

export function PixelSprite({ role, size = 4 }: Props) {
  const boxShadow = useMemo(() => getSpriteCSS(role, size), [role, size]);
  const dims = useMemo(() => getSpriteDimensions(size), [size]);

  if (!boxShadow) {
    return <div className="agent-avatar">?</div>;
  }

  return (
    <div
      className="agent-avatar"
      style={{ width: dims.width + size, height: dims.height + size, position: 'relative' }}
    >
      <div
        style={{
          width: size,
          height: size,
          boxShadow,
          position: 'absolute',
          top: 0,
          left: 0,
        }}
      />
    </div>
  );
}
