import { useEffect } from 'react';
import { useGameStore } from '../stores/gameStore';

export function useKeyboardNav() {
  const { nextMove, prevMove, goToStart, goToEnd, shiftBranch, setEditTool } = useGameStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't capture if user is typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      switch (e.key) {
        case 'ArrowRight':
          e.preventDefault();
          nextMove();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          prevMove();
          break;
        case 'ArrowUp':
          e.preventDefault();
          shiftBranch(-1);
          break;
        case 'ArrowDown':
          e.preventDefault();
          shiftBranch(1);
          break;
        case 'Escape':
          setEditTool('play');
          break;
        case 'Home':
          e.preventDefault();
          goToStart();
          break;
        case 'End':
          e.preventDefault();
          goToEnd();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [nextMove, prevMove, goToStart, goToEnd, shiftBranch, setEditTool]);
}
