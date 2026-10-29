"use client";

import React, { useEffect, useRef, useState } from "react";
import { createVoiceConnection } from "../../lib/communications.mjs";
import "./voice-room.css";

type Room = {
  id: string;
  seniorId: string;
  status: string;
  createdBy?: string;
  createdAt?: string;
};
type VoiceSignal = {
  id: string;
  senderId: string;
  payload: { type: string; sdp?: string; candidate?: RTCIceCandidateInit };
};
type Props = {
  seniorId: string;
  api: (path: string, method?: string, body?: any) => Promise<any>;
  session: {
    userId?: string;
    identityId?: string;
    role: string;
    seniorId?: string;
  };
  notify: (message: string) => void;
  onClose?: () => void;
};

/** Same-network browser audio. It never dials a telephone number or records audio. */
export function VoiceRoom({ seniorId, api, session, notify, onClose }: Props) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [room, setRoom] = useState<Room | null>(null);
  const [state, setState] = useState("idle");
  const [busy, setBusy] = useState(false);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState("");
  const [supported, setSupported] = useState(true);
  const audioRef = useRef<HTMLAudioElement>(null);
  const connectionRef = useRef<ReturnType<typeof createVoiceConnection> | null>(
    null,
  );
  const roomRef = useRef<Room | null>(null);
  const seenSignals = useRef(new Set<string>());
  const mounted = useRef(true);
  const connectTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const apiRef = useRef(api);
  const notifyRef = useRef(notify);
  const selfId = session.userId ?? session.identityId ?? "";
  apiRef.current = api;
  notifyRef.current = notify;

  function clearTimers() {
    if (connectTimeout.current) clearTimeout(connectTimeout.current);
    if (callTimeout.current) clearTimeout(callTimeout.current);
    connectTimeout.current = null;
    callTimeout.current = null;
  }
  function stopLocal() {
    clearTimers();
    connectionRef.current?.stop();
    connectionRef.current = null;
    if (audioRef.current) audioRef.current.srcObject = null;
    if (mounted.current) {
      setMuted(false);
      setState("ended");
    }
  }
  async function endCall(message = "Voice room ended") {
    const current = roomRef.current;
    stopLocal();
    roomRef.current = null;
    if (mounted.current) setRoom(null);
    if (current) {
      try {
        await apiRef.current(
          `/voice/rooms/${encodeURIComponent(current.id)}`,
          "PATCH",
          { status: "ended" },
        );
      } catch {
        if (mounted.current)
          setError(
            "Your microphone is off. The room could not be updated; it will expire automatically.",
          );
      }
    }
    if (mounted.current) notifyRef.current(message);
  }
  function activateRoom(next: Room) {
    roomRef.current = next;
    setRoom(next);
    seenSignals.current.clear();
    setError("");
    setState("connecting");
    connectTimeout.current = setTimeout(() => {
      if (stateRef.current !== "connected")
        void endCall(
          "No audio connection was established. Try two devices on the same network.",
        );
    }, 60000);
    // A showcase call must not retain a microphone indefinitely.
    callTimeout.current = setTimeout(() => {
      void endCall("Showcase call reached its 15-minute limit.");
    }, 15 * 60000);
  }
  const stateRef = useRef(state);
  stateRef.current = state;
  function createController(activeRoom: Room) {
    return createVoiceConnection({
      getMedia: (constraints: MediaStreamConstraints) =>
        navigator.mediaDevices.getUserMedia(constraints),
      createPeer: (configuration: RTCConfiguration) =>
        new RTCPeerConnection(configuration),
      send: (payload: unknown) =>
        apiRef.current(
          `/voice/rooms/${encodeURIComponent(activeRoom.id)}/signal`,
          "POST",
          { payload },
        ),
      onRemoteStream: (stream: MediaStream) => {
        if (!mounted.current || !audioRef.current) return;
        audioRef.current.srcObject = stream;
        void audioRef.current
          .play()
          .catch(() =>
            notifyRef.current(
              "Tap Play in the audio controls to hear the other participant.",
            ),
          );
      },
      onState: (next: string) => {
        if (!mounted.current) return;
        setState(next);
        stateRef.current = next;
        if (next === "connected" && connectTimeout.current) {
          clearTimeout(connectTimeout.current);
          connectTimeout.current = null;
        }
        if (next === "failed" || next === "closed")
          void endCall(
            "The audio connection ended. Same-network access may be required.",
          );
        if (next === "signaling-error")
          setError(
            "A connection signal could not be saved. End the room and try again if audio does not connect.",
          );
      },
    });
  }
  function supportCheck() {
    const available =
      typeof RTCPeerConnection !== "undefined" &&
      !!navigator.mediaDevices?.getUserMedia &&
      window.isSecureContext;
    setSupported(available);
    if (!available)
      setError(
        "Browser audio needs microphone support and HTTPS or a local development address.",
      );
    return available;
  }
  async function startCall() {
    if (busy || roomRef.current || !supportCheck()) return;
    setBusy(true);
    try {
      const result = await apiRef.current("/voice/rooms", "POST", { seniorId });
      if (!mounted.current) return;
      if (!result.room?.id)
        throw new Error("A voice room could not be created.");
      activateRoom(result.room);
      const controller = createController(result.room);
      connectionRef.current = controller;
      await controller.start();
      if (mounted.current)
        notifyRef.current(
          "Voice request created. The other participant must open Communications and choose Answer.",
        );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unable to start browser audio.";
      await endCall("Voice request cancelled");
      if (mounted.current)
        setError(
          message.includes("Permission") || /denied|NotAllowed/i.test(message)
            ? "Microphone access was not granted. No audio is being captured."
            : message,
        );
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function answerCall(incoming: Room) {
    if (busy || roomRef.current || !supportCheck()) return;
    setBusy(true);
    try {
      // Claim the recipient slot before reading private SDP / ICE data.
      await apiRef.current(
        `/voice/rooms/${encodeURIComponent(incoming.id)}`,
        "PATCH",
        { status: "active" },
      );
      const result = await apiRef.current(
        `/voice/rooms/${encodeURIComponent(incoming.id)}`,
      );
      const offer = (result.signals ?? []).find(
        (signal: VoiceSignal) =>
          signal.senderId !== selfId && signal.payload?.type === "offer",
      );
      if (!offer)
        throw new Error(
          "The caller is still preparing the connection. Try Answer again in a moment.",
        );
      if (result.room?.status === "ended")
        throw new Error("This voice request has already ended.");
      activateRoom(result.room ?? incoming);
      const controller = createController(result.room ?? incoming);
      connectionRef.current = controller;
      for (const signal of result.signals ?? []) {
        if (signal.senderId === selfId) {
          seenSignals.current.add(signal.id);
          continue;
        }
        if (signal.payload?.type === "ice")
          await controller.receive(signal.payload);
        seenSignals.current.add(signal.id);
      }
      await controller.answer(offer.payload);
      await apiRef.current(
        `/voice/rooms/${encodeURIComponent(incoming.id)}`,
        "PATCH",
        { status: "active" },
      );
    } catch (err) {
      if (roomRef.current) await endCall("Voice request cancelled");
      if (mounted.current)
        setError(
          err instanceof Error
            ? err.message
            : "Unable to answer browser audio.",
        );
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  useEffect(() => {
    mounted.current = true;
    supportCheck();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const current = roomRef.current;
        if (current) {
          const result = await apiRef.current(
            `/voice/rooms/${encodeURIComponent(current.id)}`,
          );
          if (cancelled) return;
          if (result.room?.status === "ended") {
            stopLocal();
            roomRef.current = null;
            setRoom(null);
          } else {
            for (const signal of result.signals ?? []) {
              if (cancelled) return;
              if (seenSignals.current.has(signal.id)) continue;
              // An offer is handled only by the explicit Answer action.
              if (
                signal.senderId !== selfId &&
                signal.payload?.type !== "offer"
              )
                await connectionRef.current?.receive(signal.payload);
              seenSignals.current.add(signal.id);
            }
          }
        } else {
          const result = await apiRef.current("/voice/rooms");
          if (!cancelled)
            setRooms(
              (result.rooms ?? []).filter(
                (item: Room) =>
                  item.seniorId === seniorId && item.status !== "ended",
              ),
            );
        }
      } catch (err) {
        // Stop local media when authorization, consent or room status cannot be
        // revalidated. A failed HTTP request must not leave a microphone open.
        if (!cancelled && roomRef.current) {
          stopLocal();
          roomRef.current = null;
          setRoom(null);
        }
        if (!cancelled)
          setError(
            err instanceof Error
              ? err.message
              : "Voice room status could not be loaded.",
          );
      } finally {
        if (!cancelled) timer = setTimeout(poll, roomRef.current ? 1800 : 5000);
      }
    }
    void poll();
    function leavePage() {
      stopLocal();
    }
    window.addEventListener("pagehide", leavePage);
    return () => {
      cancelled = true;
      mounted.current = false;
      clearTimeout(timer);
      clearTimers();
      connectionRef.current?.stop();
      connectionRef.current = null;
      const current = roomRef.current;
      roomRef.current = null;
      if (current)
        void apiRef
          .current(`/voice/rooms/${encodeURIComponent(current.id)}`, "PATCH", {
            status: "ended",
          })
          .catch(() => {});
      window.removeEventListener("pagehide", leavePage);
    };
  }, [seniorId, selfId]);

  const incoming = rooms.filter((item) => item.createdBy !== selfId);
  const stateLabel =
    state === "connected"
      ? "Audio connected"
      : state === "connecting"
        ? "Waiting for the other participant"
        : state === "ended"
          ? "Microphone off"
          : state === "disconnected"
            ? "Connection interrupted"
            : "Microphone off until you start or answer";
  return (
    <section className="voice-room" aria-label="Browser voice room">
      <div className="voice-room-heading">
        <div>
          <span className="voice-room-kicker">FREE BROWSER AUDIO</span>
          <h3>Talk with your care team</h3>
        </div>
        {onClose && (
          <button
            type="button"
            className="voice-room-close"
            onClick={() => {
              void endCall();
              onClose();
            }}
            aria-label="Close voice room"
          >
            ×
          </button>
        )}
      </div>
      <p className="voice-room-copy">
        A direct browser call for two authorized participants on a compatible
        network. This does not call a telephone number. No audio is recorded or
        sent to an AI service.
      </p>
      <div
        className={`voice-room-state ${state === "connected" ? "connected" : ""}`}
        role="status"
      >
        <span />
        {stateLabel}
      </div>
      {error && (
        <p className="voice-room-error" role="alert">
          {error}
        </p>
      )}
      {room ? (
        <>
          <p className="voice-room-code">
            Room {room.id.slice(0, 8)} · {room.seniorId}
          </p>
          <audio
            ref={audioRef}
            autoPlay
            controls
            aria-label="Remote participant audio"
          />
          <div className="voice-room-actions">
            <button
              type="button"
              onClick={() => {
                const value = connectionRef.current?.setMuted(!muted) ?? false;
                setMuted(value);
              }}
              disabled={!connectionRef.current?.active}
            >
              {muted ? "Unmute microphone" : "Mute microphone"}
            </button>
            <button
              type="button"
              className="voice-room-end"
              onClick={() => void endCall()}
            >
              End call
            </button>
          </div>
        </>
      ) : (
        <>
          {incoming.map((item) => (
            <div className="voice-room-incoming" key={item.id}>
              <div>
                <strong>Incoming voice request</strong>
                <span>{item.seniorId} · Waiting for your answer</span>
              </div>
              <button
                type="button"
                disabled={busy || !supported}
                onClick={() => void answerCall(item)}
              >
                Answer
              </button>
            </div>
          ))}
          <button
            type="button"
            className="voice-room-start"
            disabled={
              busy || !supported || !seniorId || session.role === "operations"
            }
            onClick={() => void startCall()}
          >
            {busy ? "Preparing voice room…" : "Start browser voice call"}
          </button>
        </>
      )}
      <p className="voice-room-limit">
        Microphone permission is requested only after Start or Answer. No relay
        or external connection service is configured, so some networks cannot
        connect. Try two authorized accounts on the same Wi-Fi. This is not an
        emergency contact channel.
      </p>
    </section>
  );
}

export default VoiceRoom;
