#!/usr/bin/env python3
"""Regression checks for bridge LAN URL host selection."""
from bridge_network import printer_route_ip, serve_host


class FakeSocket:
    def __init__(self, local_ip="192.168.1.64", error=None):
        self.local_ip = local_ip
        self.error = error
        self.connected_to = None

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def connect(self, address):
        self.connected_to = address
        if self.error:
            raise OSError(self.error)

    def getsockname(self):
        return (self.local_ip, 52525)


def factory(ip, *, calls):
    def create(family, socktype):
        sock = FakeSocket(ip)
        calls.append(sock)
        return sock
    return create


calls = []
assert printer_route_ip("192.168.1.114", socket_factory=factory("192.168.1.64", calls=calls)) == "192.168.1.64"
assert calls[0].connected_to == ("192.168.1.114", 18910)
assert serve_host("192.168.1.114", "0.0.0.0",
                  socket_factory=factory("192.168.1.64", calls=[])) == "192.168.1.64"
assert serve_host("192.168.1.114", "192.168.1.64",
                  socket_factory=factory("192.168.1.64", calls=[])) == "192.168.1.64"
assert serve_host("192.168.1.114", "0.0.0.0", "192.168.1.99") == "192.168.1.99"
assert serve_host("192.168.1.114", "0.0.0.0",
                  socket_factory=factory("100.100.100.100", calls=[])) == "100.100.100.100"


def fails(func, phrase):
    try:
        func()
    except RuntimeError as exc:
        assert phrase in str(exc), exc
    else:
        raise AssertionError("expected failure")


fails(lambda: serve_host("192.168.1.114", "127.0.0.1",
                         socket_factory=factory("192.168.1.64", calls=[])), "listening")
fails(lambda: serve_host("192.168.1.114", "0.0.0.0", "127.0.0.1"), "override")
fails(lambda: printer_route_ip("127.0.0.1"), "non-loopback")
fails(lambda: printer_route_ip("not-an-ip"), "valid IPv4")
fails(lambda: printer_route_ip("192.168.1.114",
                              socket_factory=factory("127.0.0.1", calls=[])), "unusable")
print("bridge network route selection: all checks passed")
