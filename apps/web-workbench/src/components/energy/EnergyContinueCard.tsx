import { Button } from '@/components/ui/button';
import { ArrowRight, ListRestart } from 'lucide-react';
import type { EnergyContinuationRecommendation } from './energy-continuation';

interface EnergyContinueCardProps {
  recommendation: EnergyContinuationRecommendation | null;
  onContinue: (trigger: HTMLButtonElement) => void;
  onReturn: (trigger: HTMLButtonElement) => void;
}

export function EnergyContinueCard({
  recommendation,
  onContinue,
  onReturn,
}: EnergyContinueCardProps): JSX.Element {
  return (
    <section className="mt-7 border-t border-[#eee9e5] pt-5 text-center" aria-label="继续今日能量">
      {recommendation ? (
        <>
          <p className="mx-auto max-w-md text-sm leading-6 text-[#716674]">
            {recommendation.reason}
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-3">
            <Button
              type="button"
              className="min-h-11 rounded-xl bg-[#765184] text-white hover:bg-[#664574] focus-visible:ring-[#8f6a9d]"
              onClick={(event) => onContinue(event.currentTarget)}
            >
              继续：{recommendation.label}
              <ArrowRight aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={(event) => onReturn(event.currentTarget)}
            >
              返回今日内容
            </Button>
          </div>
        </>
      ) : (
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          onClick={(event) => onReturn(event.currentTarget)}
        >
          <ListRestart aria-hidden="true" />
          继续今日内容
        </Button>
      )}
    </section>
  );
}
