import { Separator } from './ui/separator';

const SeparatorWithText = ({ text }: { text: string }) => {
  return (
    <div className='relative my-4 h-5 text-sm'>
      <Separator className='absolute inset-0 top-1/2' />
      <span className='bg-card text-muted-foreground relative mx-auto block w-fit px-2'>
        {text}
      </span>
    </div>
  );
};

export default SeparatorWithText;
