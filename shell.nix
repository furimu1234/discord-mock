# Development tools are available only in this nix-shell (no NixOS-wide changes).
# Original development machine:
# NixOS 26.05.12658.1f607aa79b63
# nixpkgs revision: 1f607aa79b6356ed45d3cd3c8079c196e79efa2c
#
# Use the local <nixpkgs> from NIX_PATH; the revision above is recorded
# for reference and is NOT pinned by this file.
{ pkgs ? import <nixpkgs> { } }:

let
  node = pkgs.nodejs_24;
  pnpm = pkgs.pnpm_11;
  python = pkgs.python313;
in
pkgs.mkShellNoCC {
  name = "discord-mock-dev";

  packages = [
    node
    pnpm
    python
    pkgs.uv
  ];

  # Use the Nix-provided Python. uv-managed CPython binaries downloaded
  # for conventional Linux distributions are not guaranteed to work on NixOS.
  UV_PYTHON = "${python}/bin/python3";
  UV_PYTHON_DOWNLOADS = "never";

  # pnpm is provided directly by Nix (no override or global installation).
  # Never auto-download the version
  # mentioned by package.json (it might differ within major version 11).
  pnpm_config_pm_on_fail = "ignore";

}
