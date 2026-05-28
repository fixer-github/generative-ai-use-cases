import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import Button from '../Button';
import ButtonCopy from '../ButtonCopy';
import ButtonSendToUseCase from '../ButtonSendToUseCase';
import { PiStopCircleBold, PiMicrophoneBold } from 'react-icons/pi';

interface MeetingMinutesControlButtonsProps {
  /** Whether recording is currently active */
  isRecording: boolean;
  /** Whether transcript text exists */
  hasTranscriptText: boolean;
  /** The transcript text for copy/send operations */
  transcriptText: string;
  /** Callback when start recording button is clicked */
  onStartRecording: () => void;
  /** Callback when stop recording button is clicked */
  onStopRecording: () => void;
  /** Callback when clear button is clicked */
  onClear: () => void;
}

const formatElapsedTime = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

const MeetingMinutesControlButtons: React.FC<
  MeetingMinutesControlButtonsProps
> = ({
  isRecording,
  hasTranscriptText,
  transcriptText,
  onStartRecording,
  onStopRecording,
  onClear,
}) => {
  const { t } = useTranslation();
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Reset and start timer when recording starts/stops
  useEffect(() => {
    if (!isRecording) {
      setElapsedSeconds(0);
      return;
    }

    setElapsedSeconds(0);
    const intervalId = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);

    return () => clearInterval(intervalId);
  }, [isRecording]);

  return (
    <div className="flex items-center gap-2">
      {/* Recording indicator */}
      {isRecording && (
        <div className="flex items-center gap-1.5">
          <span className="relative flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75"></span>
            <span className="relative inline-flex h-3 w-3 rounded-full bg-red-500"></span>
          </span>
          <span className="text-sm tabular-nums text-red-600">
            {formatElapsedTime(elapsedSeconds)}
          </span>
        </div>
      )}

      {/* Copy and Send buttons - show when transcript exists */}
      {hasTranscriptText && (
        <>
          <ButtonCopy text={transcriptText} interUseCasesKey="transcript" />
          <ButtonSendToUseCase text={transcriptText} />
        </>
      )}

      {/* Recording control buttons */}
      {!isRecording ? (
        <Button className="h-8 px-3 py-1 text-sm" onClick={onStartRecording}>
          <PiMicrophoneBold className="mr-1 h-4 w-4" />
          {t('transcribe.start_recording')}
        </Button>
      ) : (
        <Button className="h-8 px-3 py-1 text-sm" onClick={onStopRecording}>
          <PiStopCircleBold className="mr-1 h-4 w-4" />
          {t('transcribe.stop_recording')}
        </Button>
      )}

      {/* Clear button */}
      <Button
        outlined
        className="h-8 px-3 py-1 text-sm"
        disabled={!hasTranscriptText && !isRecording}
        onClick={onClear}>
        {t('common.clear')}
      </Button>
    </div>
  );
};

export default MeetingMinutesControlButtons;
