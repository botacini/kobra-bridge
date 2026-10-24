#!/usr/bin/env python3
"""Choose the LAN source address that routes to a particular printer.

No internet probe or fixed subnet is needed. UDP connect selects a route
without sending traffic; getsockname reveals the source interface IP.
"""
import ipaddress
import socket


def printer_route_ip(printer_ip: str, *, socket_factory=None) -> str:
    """Return a non-loopback IPv4 address reachable via the printer route."""
    if not printer_ip:
        raise RuntimeError("printer IP not configured; cannot determine bridge LAN address")
    try:
        destination = ipaddress.ip_address(printer_ip)
    except ValueError as exc:
        raise RuntimeError("printer IP must be a valid IPv4 address") from exc
    if destination.version != 4 or destination.is_unspecified or destination.is_loopback:
        raise RuntimeError("printer IP must be a non-loopback IPv4 address")
    create = socket_factory or socket.socket
    try:
        with create(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect((str(destination), 18910))
            source = sock.getsockname()[0]
    except OSError as exc:
        raise RuntimeError(f"cannot determine LAN route to printer {printer_ip}: {exc}") from exc
    try:
        address = ipaddress.ip_address(source)
    except ValueError as exc:
        raise RuntimeError("printer route returned an invalid local address") from exc
    if address.version != 4 or address.is_unspecified or address.is_loopback or address.is_multicast:
        raise RuntimeError(f"printer route returned an unusable LAN address: {source}")
    return str(address)


def serve_host(printer_ip: str, bind_host: str, override: str = "",
               *, socket_factory=None) -> str:
    """Resolve the host the printer must use, honoring an optional override."""
    if override:
        try:
            addr = ipaddress.ip_address(override)
            if addr.version != 4 or addr.is_unspecified or addr.is_loopback or addr.is_multicast:
                raise ValueError
        except ValueError as exc:
            raise RuntimeError("BRIDGE_HOST_IP override must be a usable IPv4 LAN address") from exc
        source = str(addr)
    else:
        source = printer_route_ip(printer_ip, socket_factory=socket_factory)
    if bind_host not in ("0.0.0.0", "", source):
        raise RuntimeError(
            f"bridge listening on {bind_host}; printer cannot download from {source}. "
            "Bind the bridge to 0.0.0.0 or its LAN address."
        )
    return source
