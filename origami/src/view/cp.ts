import { Step } from '../engine/model';

const NS = 'http://www.w3.org/2000/svg';

/** Crease pattern of the sheet after a step, with that step's creases highlighted. */
export function renderCreasePattern(svg: SVGSVGElement, step: Step) {
  svg.setAttribute('viewBox', '-0.04 -0.04 1.08 1.08');
  svg.replaceChildren();
  const g = document.createElementNS(NS, 'g');
  g.setAttribute('transform', 'matrix(1 0 0 -1 0 1)');
  svg.appendChild(g);

  const sheet = document.createElementNS(NS, 'rect');
  sheet.setAttribute('x', '0');
  sheet.setAttribute('y', '0');
  sheet.setAttribute('width', '1');
  sheet.setAttribute('height', '1');
  sheet.setAttribute('class', 'cp-sheet');
  g.appendChild(sheet);

  // flat creases first, then folded, then the step's active creases on top
  const rank = (c: Step['creases'][number]) => (c.active ? 2 : Math.abs(c.angle) > 0.05 ? 1 : 0);
  const sorted = [...step.creases].sort((a, b) => rank(a) - rank(b));
  for (const c of sorted) {
    const line = document.createElementNS(NS, 'line');
    line.setAttribute('x1', String(c.a.x));
    line.setAttribute('y1', String(c.a.y));
    line.setAttribute('x2', String(c.b.x));
    line.setAttribute('y2', String(c.b.y));
    const folded = Math.abs(c.angle) > 0.05;
    const kind = !folded ? 'flat' : c.angle > 0 ? 'valley' : 'mountain';
    line.setAttribute('class', `cp-line cp-${kind}${c.active ? ' cp-active' : ''}`);
    line.setAttribute('vector-effect', 'non-scaling-stroke');
    g.appendChild(line);
  }
}
