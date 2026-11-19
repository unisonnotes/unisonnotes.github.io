import { h, render, Fragment } from "preact";
import htm from "htm";

export const html = htm.bind(h);
export { h, render, Fragment };
export { useState, useEffect, useMemo, useRef, useCallback, useLayoutEffect } from "preact/hooks";
