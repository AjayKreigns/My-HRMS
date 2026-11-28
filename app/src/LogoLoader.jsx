import { LOADER_SVG } from './logoLoader.js';
import './logoLoader.css';

// The whole iFe Hive logo animating (petals bloom, the figure rises, the sun pulses, the letters rise one by one).
// Shown while a page's code is loading. The same artwork is also inline in index.html for the very first load.
export default function LogoLoader() {
  return (
    <div className="lgl-wrap" role="status">
      <span className="sr-only">Loading</span>
      <span aria-hidden="true" dangerouslySetInnerHTML={{ __html: LOADER_SVG }} />
    </div>
  );
}
